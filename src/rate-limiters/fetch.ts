import { AbstractRateLimiter, RateLimiterConfig } from "../rate-limiter.js";
import { getPolicy } from "../helpers.js";

type Fetch = typeof fetch;
type Args = Parameters<Fetch>;
type Result = ReturnType<Fetch>;

export class FetchRateLimiter extends AbstractRateLimiter<Args, Result> {
  constructor(conf?: Partial<RateLimiterConfig>) {
    super(conf);
  }

  protected makeRequest = fetch;

  protected headRequest = (fn: typeof fetch, ...[req, init = {}]: Parameters<typeof fetch>) => {
    let url: string | URL;
    if (typeof req !== "string" && "url" in req) {
      url = req.url;
    } else {
      url = req;
    }
    return fn(url, { method: "HEAD" });
  };

  protected extractPolicy = ({ headers }: Response) => getPolicy(headers.get.bind(headers));

  protected getPath = (req: RequestInfo | URL, init?: RequestInit | undefined) => {
    if (typeof req !== "string" && "url" in req) {
      return new URL(req.url).pathname;
    } else {
      return new URL(req).pathname;
    }
  };
}
