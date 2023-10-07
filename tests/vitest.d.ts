import type { Assertion, AsymmetricMatchersContaining } from "vitest";
interface CustomMatcherResult {
  pass: boolean;
  message: () => string;
  // If you pass these, they will automatically appear inside a diff when
  // the matcher does not pass, so you don't need to print the diff yourself
  actual?: unknown;
  expected?: unknown;
}

interface CustomMatchers<T> {
  toBeResolved: T extends Promise<any>
    ? () => CustomMatcherResult
    : T extends Promise<any>[]
    ? () => CustomMatcherResult
    : never;
  toBeUnresolved: T extends Promise<any>
    ? () => CustomMatcherResult
    : T extends Promise<any>[]
    ? () => CustomMatcherResult
    : never;
}

declare module "vitest" {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining<T = any> extends CustomMatchers<T> {}
}
