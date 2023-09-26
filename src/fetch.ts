import { Limit, Limits, Policy, RateLimiter, RateLimiterConfig, State, States } from ".";

type Fetch = typeof fetch;
type Args = Parameters<Fetch>;
type Result = ReturnType<Fetch>;

export class FetchRateLimiter extends RateLimiter<Args, Result> {
  constructor(conf?: RateLimiterConfig) {
    super(fetch, fetchPath, fetchExtractor, fetchHeader, conf);
  }
}

export function getLimits(text?: string | null): Limit[] {
  return (
    text?.split(",").map((rule) => {
      const [count, seconds, retry] = rule.split(":").map((n) => parseInt(n));
      return { count, seconds, retry };
    }) || []
  );
}

export function getState(text?: string | null): State[] {
  const timestamp = performance.now();
  return (
    text?.split(",").map((rule) => {
      const [count, seconds, retry] = rule.split(":").map((n) => parseInt(n));
      return { count, seconds, retry, timestamp };
    }) || []
  );
}

export function fetchHeader(fn: typeof fetch, ...[req, init = {}]: Parameters<typeof fetch>) {
  return fn(req, { ...init, method: "HEAD" });
}

export function fetchPath(...[req]: Parameters<typeof fetch>) {
  if (typeof req !== "string" && "url" in req) {
    return new URL(req.url).pathname;
  } else {
    return new URL(req).pathname;
  }
}

export function fetchExtractor({ headers }: Response): Policy {
  const retry = headers.get("Retry-After");
  const rules =
    headers
      .get("X-Rate-Limit-Rules")
      ?.split(",")
      ?.map((s) => s.trim()) || [];
  const limits: Limits = {};
  const state: States = {};
  for (const rule of rules) {
    limits[rule] = getLimits(headers.get(`X-Rate-Limit-${rule}`));
    state[rule] = getState(headers.get(`X-Rate-Limit-${rule}-State`));
  }

  return {
    name: headers.get("X-Rate-Limit-Policy") || "",
    limits,
    state,
    retryAfter: (retry && parseInt(retry)) || 0,
  };
}
