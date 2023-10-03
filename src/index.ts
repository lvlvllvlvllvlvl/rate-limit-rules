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

type InternalState<T extends any[], R> = {
  timeoutID?: any;
  timestamps: { time: number }[];
  active: Promise<Policy>[];
  queue: {
    args: T;
    resolve: (value: Awaited<R>) => void;
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
   * maximum number of active requests per policy
   *
   * Default: unlimited
   */
  maxActive: number;
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
  private state = new Proxy({} as { [policy: string]: InternalState<T, R> }, {
    get: (target, name): InternalState<T, R> => {
      const val = target[String(name)];
      return val || (target[String(name)] = { timestamps: [], active: [], queue: [] });
    },
  });
  private conf: RateLimiterConfig = {
    waitOnStateMs: 1000,
    maxActive: 0,
    logging: {
      error: console.error,
    },
    defaultLimits: [{ count: 1, seconds: 1, retry: 0 }],
  };
  private thread = Promise.resolve(null as any);

  constructor(
    private makeRequest: (...args: T) => R,
    private policyExtractor: (result: R) => Policy | Promise<Policy>,
    private head: (fn: (...args: T) => R, ...args: T) => R | Promise<R>,
    conf?: Partial<RateLimiterConfig>
  ) {
    conf && Object.assign(this.conf, conf);
  }

  public request = async (...args: T): Promise<Awaited<R>> => {
    const policy = await this.policyExtractor(
      await (this.thread = this.thread.catch().then(() => this.head(this.makeRequest, ...args)))
    );

    return await new Promise<R>((resolve, reject) => {
      this.state[policy.name].queue.push({ args, resolve, reject });
      this.followPolicy(policy);
    });
  };

  private followPolicy = (policy: Policy) => {
    const state = this.state[policy.name];
    while (!state.timeoutID && state.queue.length) {
      try {
        this.conf.logging.debug?.(
          "follow policy",
          policy.name,
          state.timestamps,
          state.active.length,
          "active",
          state.queue.length,
          "queued"
        );
        const wait = this.checkLimits(policy);
        this.conf.logging.debug?.("wait", policy.name, wait);
        if (wait instanceof Promise) {
          this.conf.logging.debug?.("waiting on active request", policy.name);
          wait.then(async (result) => {
            await sleep();
            this.followPolicy(result ? await result : policy);
          });
          break;
        } else if (wait && wait > 0) {
          state.timeoutID = setTimeout(() => {
            state.timeoutID = null;
            if (state.queue.length) {
              this.thread = this.thread.catch().then(() => this.head(this.makeRequest, ...state.queue[0].args));
              this.thread.then(this.policyExtractor).then(this.followPolicy);
            }
          }, wait);
        } else {
          state.timeoutID = null;
          const active = state.active.length;
          this.nextRequest(policy);
          if (state.active.length !== active + 1) {
            this.conf.logging.debug?.(active, state.active.length, this.state[policy.name].active);
          }
        }
      } catch (e) {
        this.conf.logging.warn?.(e);
      }
    }
  };

  private nextRequest = (policy: Policy) => {
    const state = this.state[policy.name];
    const next = state.queue.shift();

    if (next) {
      const { args, resolve, reject } = next;
      const thisPromise = Promise.resolve(this.makeRequest(...args))
        .then((result: any) => {
          state.active = state.active.filter((v) => v !== thisPromise);
          state.timestamps.push({ time: performance.now() });
          this.conf.logging.debug?.(policy.name, "request complete with args:", ...args);
          resolve(result);
          return Promise.resolve(this.policyExtractor(result));
        })
        .catch((reason) => {
          state.active = state.active.filter((v) => v !== thisPromise);
          state.timestamps.push({ time: performance.now() });
          this.followPolicy(policy);
          this.conf.logging.debug?.(policy.name, "request failed", reason);
          reject(reason);
          return policy;
        });

      this.conf.logging.debug?.(policy.name, "queued request with args:", ...args);
      state.active.push(thisPromise);
    } else {
      this.conf.logging.debug?.("No requests in queue");
    }
  };

  private checkLimits = (policy: Policy) => {
    let waitUntil = 0;
    for (const [rule, limits] of Object.entries(policy.limits)) {
      const states = policy.state[rule] || [];
      for (let i = 0; i < limits.length; i++) {
        const nextWait = this.checkLimit(this.state[policy.name], limits[i], states[i]);
        if (nextWait instanceof Promise) {
          return nextWait;
        }
        waitUntil = Math.max(waitUntil, nextWait);
      }
    }
    const wait = waitUntil - performance.now();
    return wait > 0 ? wait : undefined;
  };

  private checkLimit = ({ timestamps, active }: InternalState<T, R>, limit: Limit, state?: State) => {
    if ((this.conf.maxActive > 0 && active.length >= this.conf.maxActive) || active.length >= limit.count) {
      return Promise.race(active);
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
    if (state && state.timestamp + state.seconds * 1000 > performance.now()) {
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
  };
}
