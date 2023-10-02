import { FetchRateLimiter } from "./rate-limiters/fetch";

export const { request: fetch } = new FetchRateLimiter({ logging: console });
