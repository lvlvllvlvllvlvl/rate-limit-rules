import { sleep } from "./helpers.js";

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
  timestamps: { started: number; ended: number }[];
  active: { started: number; request: Promise<Policy> }[];
  queue: {
    args: T;
    resolve: (value: Awaited<R>) => void;
    reject: (reason: any) => void;
  }[];
};

export interface RateLimiterConfig {
  /**
   * When the hit count of any state value equals the maximum hit count of the corresponding limit,
   * wait until this many milliseconds after the state was last updated before trying again
   *
   * Default: 1000
   */
  waitOnStateMs: number;
  /**
   * If defined, if a policy would cause a known wait longer than this value,
   * an exception will be thrown instead
   *
   */
  maxWaitMs?: number;
  /**
   * Minimum time between active requests
   *
   * Default: 0
   */
  requestDelayMs: number;
  /**
   * Maximum number of active requests per policy.
   * Setting this to any number higher than 1 can result in exceeding the rate limit policy,
   * as GGG sometimes reduce the limit while requests are in progress.
   *
   * Default: 1
   */
  maxActive: number;
  /**
   * Logging functions for debug or error messages
   *
   * Default: { error: console.error }
   */
  logging: {
    debug?: (...data: any[]) => void;
    error?: (...data: any[]) => void;
    [other: string]: any;
  };
}

export abstract class AbstractRateLimiter<T extends any[], R> {
  private state = new Proxy({} as { [policy: string]: InternalState<T, R> }, {
    get: (target, name): InternalState<T, R> => {
      const val = target[String(name)];
      return val || (target[String(name)] = { timestamps: [], active: [], queue: [] });
    },
  });

  private policyByPath = {} as Map<string>;

  protected conf: RateLimiterConfig = {
    waitOnStateMs: 1000,
    requestDelayMs: 0,
    maxActive: 1,
    logging: {
      error: console.error,
    },
  };
  private thread = Promise.resolve(null as any);

  constructor(conf?: Partial<RateLimiterConfig>) {
    conf && Object.assign(this.conf, conf);
  }

  protected abstract makeRequest: (...args: T) => R;
  protected abstract headRequest: (fn: (...args: T) => R, ...args: T) => R | Promise<R>;
  protected abstract extractPolicy: (result: Awaited<R>) => Policy;
  protected abstract getPath: (...args: T) => string;

  public request = async (...args: T): Promise<Awaited<R>> => {
    this.thread = this.thread.catch().then(() => this.headRequest(this.makeRequest, ...args));
    const policy: Policy = await this.thread
      .then(this.extractPolicy)
      .catch(() => this.defaultPolicy(this.getPath(...args)));

    return await new Promise<R>((resolve, reject) => {
      this.state[policy.name].queue.push({ args, resolve, reject });
      this.followPolicy(policy);
    });
  };

  private defaultPolicy = (path: string) => {
    return { name: "path:" + path, limits: { default: [{ count: 1, seconds: 0, retry: 0 }] }, state: {} };
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
          if (this.conf.maxWaitMs != undefined && this.conf.maxWaitMs < wait) {
            for (const queued of state.queue) {
              queued.reject(wait + "ms wait");
            }
            state.queue = [];
          }
          state.timeoutID = setTimeout(() => {
            state.timeoutID = null;
            if (state.queue.length) {
              this.thread = this.thread.catch().then(() => this.headRequest(this.makeRequest, ...state.queue[0].args));
              this.thread.then(this.extractPolicy).catch().then(this.followPolicy);
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
      const started = performance.now();
      const request = Promise.resolve(this.makeRequest(...args))
        .then(async (r) => {
          const result = await r;
          state.active = state.active.filter((v) => v.request !== request);
          state.timestamps.push({ started, ended: performance.now() });
          this.conf.logging.debug?.(policy.name, "request complete with args:", ...args);
          resolve(result);
          const extracted = this.extractPolicy(await result);
          if (policy.name.startsWith("path:")) {
            this.state[extracted.name].queue.push(...state.queue);
            state.queue = [];
          }
          return extracted;
        })
        .catch((reason) => {
          state.active = state.active.filter((v) => v.request !== request);
          state.timestamps.push({ started, ended: performance.now() });
          this.followPolicy(policy);
          this.conf.logging.debug?.(policy.name, "request failed", reason);
          reject(reason);
          return policy;
        });

      this.conf.logging.debug?.(policy.name, "queued request with args:", ...args);
      state.active.push({ request, started });
    } else {
      this.conf.logging.debug?.("No requests in queue");
    }
  };

  private checkLimits = (policy: Policy) => {
    let waitUntil = 0;
    const state = this.state[policy.name];
    for (const [rule, limits] of Object.entries(policy.limits)) {
      const ruleStates = policy.state[rule] || [];
      for (let i = 0; i < limits.length; i++) {
        const nextWait = this.checkLimit(state, limits[i], ruleStates[i]);
        if (nextWait instanceof Promise) {
          return nextWait;
        }
        waitUntil = Math.max(waitUntil, nextWait);
      }
    }
    const lastReq = state.active[state.active.length - 1];
    if (lastReq && waitUntil < lastReq.started + this.conf.requestDelayMs) {
      const wait = lastReq.started + this.conf.requestDelayMs - performance.now();
      return Promise.race([lastReq.request, sleep(wait / 1000)]);
    }
    const wait = waitUntil - performance.now();
    return wait > 0 ? wait : undefined;
  };

  private checkLimit = ({ timestamps, active }: InternalState<T, R>, limit: Limit, state?: State) => {
    if ((this.conf.maxActive > 0 && active.length >= this.conf.maxActive) || active.length >= limit.count) {
      return Promise.race(active.map((a) => a.request));
    }
    let waitUntil = 0;
    const max = limit.count - active.length;
    if (timestamps.length >= max) {
      const start = performance.now() - limit.seconds * 1000;
      const idx = timestamps.findIndex((t) => t.ended > start);
      if (idx >= 0 && timestamps.length - idx >= limit.count) {
        waitUntil = timestamps[idx].ended + limit.seconds * 1000;
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
