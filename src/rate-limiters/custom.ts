import { Policy, AbstractRateLimiter, RateLimiterConfig } from "../rate-limiter.js";

export class RateLimiter<T extends any[], R> extends AbstractRateLimiter<T, R> {
  constructor(
    protected makeRequest: (...args: T) => R,
    protected headRequest: (fn: (...args: T) => R, ...args: T) => R | Promise<R>,
    protected extractPolicy: (result: R) => Policy,
    protected getPath: (...args: T) => string,
    conf?: Partial<RateLimiterConfig>
  ) {
    super(conf);
  }
}
