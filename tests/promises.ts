export function mockPromise<TResult = any>() {
  let resolve: (args?: TResult) => void, reject: (reason?: any) => void;
  const promise = new Promise<TResult>((r, e) => ((resolve = r as any), (reject = e)));
  return [promise, resolve!, reject!] as const;
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race
// If the iterable contains one or more non-promise values and/or an already settled promise,
// then Promise.race() will settle to the first of these values found in the iterable.
export const isUnresolved = (promise: Promise<any>) => Promise.race([promise, unresolved]);

class Unresolved {
  toString = () => "Unresolved Promise";
}
export const unresolved = new Unresolved();
