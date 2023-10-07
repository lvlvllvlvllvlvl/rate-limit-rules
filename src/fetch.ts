import { FetchRateLimiter } from "./rate-limiters/fetch.js";

export const { request: fetch } = new FetchRateLimiter({ logging: console });
