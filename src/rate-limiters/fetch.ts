import { AbstractRateLimiter, RateLimiterConfig } from "../index";
import { getPolicy } from "../helpers";

type Fetch = typeof fetch;
type Args = Parameters<Fetch>;
type Result = ReturnType<Fetch>;

export class FetchRateLimiter extends AbstractRateLimiter<Args, Result> {
  constructor(conf?: Partial<RateLimiterConfig>) {
    super(conf);
  }

  protected makeRequest = fetch;

  protected head = (fn: typeof fetch, ...[req, init = {}]: Parameters<typeof fetch>) =>
    fn(req, { ...init, method: "HEAD", body: undefined });

  protected policyExtractor = ({ headers }: Response) => getPolicy(headers.get.bind(headers));
}
