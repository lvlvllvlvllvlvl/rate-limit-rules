import { describe, expect, it, vi } from "vitest";
import { sleep } from "../src/helpers";
import { RateLimiter } from "../src/rate-limiters/custom";
import { isUnresolved, mockPromise, unresolved } from "./promises";

describe("rate-limiter", () => {
  it("waits for head result before sending requests", async () => {
    const [promise, resolve] = mockPromise();

    const { request } = new RateLimiter(
      (url: string) => url,
      () => promise,
      () => ({ name: "policy", limits: {}, state: {} }),
      () => ""
    );

    const results = Promise.all([request("url1"), request("url2"), request("url3")]);

    expect(await isUnresolved(results)).toBe(unresolved);

    resolve("response");

    await expect(results).resolves.toBeTruthy();
  });

  it("waits for the time specified in the policy", async () => {
    const [promise, resolve] = mockPromise();
    const req = vi.fn(() => promise);

    const { request } = new RateLimiter(
      req,
      () => undefined,
      () => ({ name: "policy", limits: { single: [{ count: 1, seconds: 0.1, retry: 5 }] }, state: {} }),
      () => ""
    );

    const results = [request(), request(), request(), request()];

    await sleep();
    expect(req).toBeCalledTimes(1);
    resolve();
    await sleep(0.05);
    expect(req).toBeCalledTimes(1);
    await sleep(0.06);
    expect(req).toBeCalledTimes(2);
    await sleep(0.1);
    expect(req).toBeCalledTimes(3);
    await sleep(0.1);
    expect(req).toBeCalledTimes(4);
    expect(Promise.all(results)).resolves.toBeTruthy();
  });

  it("makes the next request when there is an error", async () => {
    const [promise, _, reject] = mockPromise();
    const req = vi.fn(() => promise);

    const { request } = new RateLimiter(
      req,
      () => undefined,
      () => ({ name: "policy", limits: { single: [{ count: 1, seconds: 0.1, retry: 5 }] }, state: {} }),
      () => ""
    );

    const requests = [request(), request(), request(), request()];

    await sleep();
    expect(req).toBeCalledTimes(1);
    reject();
    await expect(Promise.allSettled(requests)).resolves.toBeTruthy();
  });

  it("handles error in policy extractor", async () => {
    const { request } = new RateLimiter(
      () => "result",
      () => undefined,
      () => {
        throw "error";
      },
      () => ""
    );

    const requests = [request(), request(), request(), request()];

    for (const result of requests) {
      await expect(result).resolves.toBe("result");
    }
  });

  it("returns rejection in header method", async () => {
    const [promise, _, reject] = mockPromise();

    const { request } = new RateLimiter(
      (url: string) => Promise.resolve(url),
      () => promise,
      () => ({ name: "policy", limits: {}, state: {} }),
      () => ""
    );

    const results = Promise.all([request("url1"), request("url2"), request("url3")]);

    expect(await isUnresolved(results)).toBe(unresolved);

    reject("error");

    await expect(results).resolves.toEqual(["url1", "url2", "url3"]);
  });
});
