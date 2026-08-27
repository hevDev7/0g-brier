import {cleanup} from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import type {TestingLibraryMatchers} from "@testing-library/jest-dom/matchers";
import {afterEach, expect} from "vitest";

// Not `import "@testing-library/jest-dom/vitest"` (the usual line): that file
// imports `expect` from its own 'vitest', resolved from the jest-dom package's
// location (hoisted to the workspace root node_modules, where vitest@3 lives for
// packages/protocol) — not from the frontend's `expect` (vitest@4, nested in
// frontend/node_modules because its version range conflicts with protocol's).
// Two different 'vitest' module instances mean two different Chai registries: the
// matchers register on one, while the test files use the other. Importing the raw
// matchers and extending the `expect` resolved from here (frontend/) guarantees
// both use the same vitest instance.
expect.extend(matchers);

// `test.globals` is deliberately off (see vitest.config.ts), so `afterEach` is not
// global — and @testing-library/react's built-in auto-cleanup (which registers
// itself only when `typeof afterEach === "function"` in its own scope) never fires.
// Without this line, the render() from one `it` keeps piling up in document.body
// afterwards, and `screen`-based queries in the next `it` (in the same file) can
// find duplicate nodes left over from another test instead of only their own.
afterEach(cleanup);

// The same type augmentation must be declared from HERE (frontend/) rather than
// imported from `@testing-library/jest-dom/vitest`, for an identical reason: the
// `declare module "vitest"` in that file resolves 'vitest' from the jest-dom
// package's location (the root), which augments vitest@3's types — not the
// frontend's vitest@4 that the test files use. Declared here, "vitest" resolves to
// frontend/node_modules/vitest, the same types the test files use.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type --
   This shape is identical to @testing-library/jest-dom's own types/vitest.d.ts: an empty
   interface extending TestingLibraryMatchers IS the sanctioned way to add matchers to Assertion
   through declaration merging. The `any` here is mandatory: TestingLibraryMatchers' first generic
   parameter is typed `any` throughout jest-dom's own definitions, and the `T = any` default must
   match Assertion's original declaration in @vitest/expect exactly for TypeScript to merge them. */
declare module "vitest" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
