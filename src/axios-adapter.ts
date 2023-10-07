import { AxiosRateLimiter } from "./rate-limiters/axios-adapter";

export const { request: adapter } = new AxiosRateLimiter();
