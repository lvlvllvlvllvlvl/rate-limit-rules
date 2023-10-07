import axios, { AxiosAdapter, AxiosPromise, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { AbstractRateLimiter, RateLimiterConfig } from "../index";
import { getPolicy } from "../helpers";

export class AxiosRateLimiter extends AbstractRateLimiter<[InternalAxiosRequestConfig], AxiosPromise> {
  private adapter: AxiosAdapter;

  constructor(conf?: Partial<RateLimiterConfig & { adapter: AxiosRequestConfig["adapter"] }>) {
    super(conf);
    const adapterConfig = conf?.adapter || axios.defaults.adapter;
    this.adapter = adapterConfig instanceof Function ? adapterConfig : axios.getAdapter(adapterConfig);
  }

  protected makeRequest = (config: InternalAxiosRequestConfig) => this.adapter(config);

  protected head = (fn: (config: InternalAxiosRequestConfig) => AxiosPromise, config: InternalAxiosRequestConfig) =>
    fn({ ...config, method: "HEAD", data: undefined });

  protected policyExtractor = ({ headers }: Awaited<AxiosPromise>) => getPolicy((h) => headers[h]);
}
