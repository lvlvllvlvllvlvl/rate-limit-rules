import { AxiosRateLimiter } from "./rate-limiters/axios-adapter.js";

export const { request: adapter } = new AxiosRateLimiter();
