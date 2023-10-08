import { Limit, Limits, State, States } from "./rate-limiter.js";

export async function sleep(seconds: number = 0): Promise<void> {
  if (!seconds && typeof setImmediate === "function") {
    return new Promise(setImmediate);
  } else {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
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

const trim = (s: string) => s.trim();

export function getPolicy(getHeader: (name: string) => string | null | undefined) {
  const name = getHeader("X-Rate-Limit-Policy");
  if (!name) throw "no policy";
  const retryAfter = parseInt(getHeader("Retry-After")!) || 0;
  const rules = getHeader("X-Rate-Limit-Rules")?.split(",")?.map(trim) || [];
  const limits: Limits = {};
  const state: States = {};
  for (const rule of rules) {
    limits[rule] = getLimits(getHeader(`X-Rate-Limit-${rule}`));
    state[rule] = getState(getHeader(`X-Rate-Limit-${rule}-State`));
  }

  return { name, limits, state, retryAfter };
}
