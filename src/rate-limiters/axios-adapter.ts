import { AxiosAdapter, AxiosPromise, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { AbstractRateLimiter, RateLimiterConfig } from "../rate-limiter.js";
import { getPolicy } from "../helpers.js";

export class AxiosRateLimiter extends AbstractRateLimiter<[InternalAxiosRequestConfig], AxiosPromise> {
  private adapter: Promise<AxiosAdapter>;

  constructor(conf?: Partial<RateLimiterConfig & { adapter: AxiosRequestConfig["adapter"] }>) {
    super(conf);
    const axios = import("axios");
    this.adapter = Promise.resolve(conf?.adapter || axios.then(({ default: axios }) => axios.defaults.adapter)).then(
      (adapterConfig) =>
        adapterConfig instanceof Function ? adapterConfig : axios.then(({ getAdapter }) => getAdapter(adapterConfig))
    );
  }

  protected makeRequest = (config: InternalAxiosRequestConfig) => this.adapter.then((fn) => fn(config));

  protected headRequest = (
    fn: (config: InternalAxiosRequestConfig) => AxiosPromise,
    config: InternalAxiosRequestConfig
  ) => fn({ ...config, method: "HEAD" });

  protected extractPolicy = ({ headers }: Awaited<AxiosPromise>) => getPolicy((h) => headers[h]);

  protected getPath = (config: InternalAxiosRequestConfig) => (config.url ? new URL(config.url).pathname : "");
}
