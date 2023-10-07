import { Policy, AbstractRateLimiter, RateLimiterConfig } from "../rate-limiter.js";

export class RateLimiter<T extends any[], R> extends AbstractRateLimiter<T, R> {
  constructor(
    protected makeRequest: (...args: T) => R,
    protected policyExtractor: (result: R) => Policy | Promise<Policy>,
    protected head: (fn: (...args: T) => R, ...args: T) => R | Promise<R>,
    conf?: Partial<RateLimiterConfig>
  ) {
    super(conf);
  }
}
