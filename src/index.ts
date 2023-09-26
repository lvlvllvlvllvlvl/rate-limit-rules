type Map<V> = { [key: string]: V | undefined };

export interface Limit {
  /** the maximum hits */
  count: number;
  /** the period (in seconds) tested */
  seconds: number;
  /** the time restricted (in seconds) if the rule is broken */
  retry: number;
}

export interface State {
  /** the current hit count */
  count: number;
  /** the period (in seconds) tested */
  seconds: number;
  /** the active time restricted in seconds (this will be 0 if the request is not rate limited) */
  retry: number;
  /** `performance.now()` value at the time the state was received */
  timestamp: number;
}

export type Limits = Record<string, Limit[]>;

export type States = Map<State[]>;

export interface Policy {
  /**
   * The name of the policy that applies to this request.
   * Policies may be the same across different API endpoints but are treated the same for rate limiting purposes.
   */
  name: string;
  /** The rules that apply to this request. */
  limits: Limits;
  /** The current state of each rule. */
  state: States;
  /** Time to wait (in seconds) until the rate limit expires. */
  retryAfter?: number;
}

type InternalState<T extends any[]> = {
  timeoutID?: any;
  timestamps: { path: string; time: number }[];
  active: Promise<string>[];
  queue: {
    args: T;
    getPolicy: (result: any) => Policy | Promise<Policy>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }[];
};

export async function sleep(seconds?: number) {
  if (seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  } else {
    return new Promise(setImmediate);
  }
}

export interface RateLimiterConfig {
  /**
   * when the hit count of any state value equals the maximum hit count of the corresponding limit,
   * wait until this many milliseconds after the state was last updated before trying again
   *
   * Default: 1000
   */
  waitOnStateMs: number;
  /**
   * when comparing state hit count to maximum hit count, multiply the maximum by this value
   *
   * Default: 0.9
   */
  stateFraction: number;
  /**
   * enable logging at various levels
   */
  logging: {
    [level in "trace" | "debug" | "log" | "warn" | "error"]?: (...data: any[]) => void;
  } & { [other: string]: any };
  /**
   * rules to use when the policy for a path is unknown,
   * e.g. the first request to an api when header function is not configured
   *
   * Default: 1 request per second
   */
  defaultLimits: Limit[];
}

export class RateLimiter<T extends any[], R> {
  private policies: Map<Policy> & { "": Policy };
  private policiesByPath: Map<Promise<string>> = {};
  private state = new Proxy({} as { [policy: string]: InternalState<T> }, {
    get: (target, name): InternalState<T> => {
      const val = target[String(name)];
      return val || (target[String(name)] = { timestamps: [], active: [], queue: [] });
    },
  });
  private conf: RateLimiterConfig = {
    waitOnStateMs: 1000,
    stateFraction: 0.9,
    logging: {
      error: console.error,
    },
    defaultLimits: [{ count: 1, seconds: 1, retry: 0 }],
  };

  constructor(
    private makeRequest: (...args: T) => R,
    private pathExtractor: (...args: T) => string,
    private policyExtractor: (result: Awaited<R>) => Policy | Promise<Policy>,
    private head?: (fn: (...args: T) => R, ...args: T) => R | Promise<R>,
    conf?: Partial<RateLimiterConfig>
  ) {
    conf && Object.assign(this.conf, conf);
    this.policies = {
      "": {
        name: "",
        limits: { default: this.conf.defaultLimits },
        state: {},
      },
    };
  }

  public request = async (...args: T) => {
    try {
      const path = this.pathExtractor(...args);
      let policyName = this.policiesByPath[path] ? (await this.policiesByPath[path]) || "" : "";
      if (!policyName && this.head) {
        try {
          policyName = await this.setPolicy(
            Promise.resolve(this.head(this.makeRequest, ...args)).then(this.policyExtractor),
            path
          );
        } catch (e) {
          this.conf.logging.warn?.("Error calling header method", e);
        }
      }

      this.conf.logging.debug?.("request added to the queue with args:", args);
      return new Promise<R>((resolve, reject) => {
        this.state[policyName].queue.push({ args, getPolicy: this.policyExtractor, resolve, reject });
        this.followPolicy(policyName);
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };

  private async setPolicy<R>(policy: Promise<Policy>, path: string) {
    const policyName = policy.then(({ name }) => name);
    this.policiesByPath[path] = policyName;

    const name = await policyName;

    if (this.state[""].queue.length || this.state[""].active.length) {
      this.updatePolicy(path, name);
    }

    this.policies[name] = await policy;
    return name;
  }

  private updatePolicy(path: string, name: string) {
    this.conf.logging.debug?.("setting policy", name, "for path", path);
    this.state[""].queue = this.state[""].queue.filter((i) => {
      if (this.pathExtractor(...i.args) === path) {
        this.state[name].queue.push(i);
        return false;
      } else {
        return true;
      }
    });
    this.state[""].timestamps = this.state[""].timestamps.filter((i) => {
      if (i.path === path) {
        this.state[name].timestamps.push(i);
        return false;
      } else {
        return true;
      }
    });
  }

  private followPolicy(name: string) {
    const policy = this.policies[name] || this.policies[""];
    const state = this.state[name];
    while (!state.timeoutID && state.queue.length) {
      try {
        this.conf.logging.debug?.("follow policy", policy, state);
        const wait = this.checkLimits(policy);
        this.conf.logging.debug?.("wait", wait);
        if (wait && wait > 0) {
          state.timeoutID = setTimeout(() => {
            state.timeoutID = null;
            this.followPolicy(name);
          }, wait);
        } else {
          this.nextRequest(name);
        }
      } catch (e) {
        if (e instanceof Promise) {
          this.conf.logging.debug?.("waiting on active request", policy.name);
          e.then(async (result) => {
            await sleep();
            this.followPolicy(result ? String(result) : name);
          });
          break;
        } else {
          this.conf.logging.warn?.(e);
        }
      }
    }
  }

  private nextRequest(name: string) {
    const state = this.state[name];
    state.timeoutID = null;
    const next = state.queue.pop();

    if (next) {
      const { args, getPolicy, resolve, reject } = next;
      const path = this.pathExtractor(...args);
      this.conf.logging.debug?.("making request with args:", args);
      const thisPromise = Promise.resolve(this.makeRequest(...args))
        .then((result: any) => {
          state.active = state.active.filter((v) => v !== thisPromise);
          state.timestamps.push({ path, time: performance.now() });
          this.conf.logging.debug?.("request complete with result:", result);
          resolve(result);
          return this.setPolicy(Promise.resolve(getPolicy(result)), path).then((name) => {
            this.followPolicy(name);
            return name;
          });
        })
        .catch((reason) => {
          state.active = state.active.filter((v) => v !== thisPromise);
          state.timestamps.push({ path, time: performance.now() });
          this.followPolicy(name);
          this.conf.logging.debug?.("request failed", reason);
          reject(reason);
          return name;
        });

      state.active.push(thisPromise);
    }
  }

  private checkLimits(policy: Policy) {
    let waitUntil = 0;
    for (const [rule, limits] of Object.entries(policy.limits)) {
      const states = policy.state[rule] || [];
      for (let i = 0; i < limits.length; i++) {
        waitUntil = Math.max(waitUntil, this.checkLimit(this.state[policy.name], limits[i], states[i]));
      }
    }
    const wait = waitUntil - performance.now();
    return wait > 0 ? wait : 0;
  }

  private checkLimit({ timestamps, active }: InternalState<T>, limit: Limit, state?: State) {
    if (active.length >= limit.count) {
      throw Promise.race(active);
    }
    let waitUntil = 0;
    const max = limit.count - active.length;
    if (timestamps.length >= max) {
      const start = performance.now() - limit.seconds * 1000;
      const idx = timestamps.findIndex((t) => t.time > start);
      if (idx >= 0 && timestamps.length - idx >= limit.count) {
        waitUntil = timestamps[idx].time + limit.seconds * 1000;
      }
    }
    if (state) {
      if (state.retry) {
        waitUntil = Math.max(waitUntil, state.timestamp + state.retry * 1000);
      }
      if (state.count >= limit.count) {
        waitUntil = Math.max(waitUntil, state.timestamp + this.conf.waitOnStateMs);
      }
    }
    if (waitUntil > performance.now()) {
      this.conf.logging.debug?.("wait", waitUntil, performance.now(), limit, state);
    } else {
      this.conf.logging.debug?.("no wait", limit, state);
    }
    return waitUntil;
  }
}
