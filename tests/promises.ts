import { expect } from "vitest";

export function mockPromise<TResult = any>() {
  let resolve: (args?: TResult) => void, reject: (reason?: any) => void;
  const promise = new Promise<TResult>((r, e) => ((resolve = r as any), (reject = e)));
  return [promise, resolve!, reject!] as const;
}

const token = new Object();
expect.extend({
  toBeResolved: async (promises: Promise<any> | Promise<any>[]) => {
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race
    // If the iterable contains one or more non-promise values and/or an already settled promise,
    // then Promise.race() will settle to the first of these values found in the iterable.
    const result = await (Array.isArray(promises)
      ? Promise.race([...promises, token])
      : Promise.race([promises, token]));

    return {
      pass: result !== token,
      message: () => "",
    };
  },
  toBeUnresolved: async (promises: Promise<any> | Promise<any>[]) => {
    const result = await (Array.isArray(promises)
      ? Promise.race([...promises, token])
      : Promise.race([promises, token]));
    return {
      pass: result === token,
      message: () => `Expected promise to be unresolved, but it resolved to ${result}`,
    };
  },
});
