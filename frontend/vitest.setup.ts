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

// `ZgStore` now keeps verified documents in `localStorage`, which jsdom shares
// across every test in a file. That is the point in a browser — a document
// proved once need not be fetched again on the next visit — and poison in a
// test run: one case caching a spec made the next one, which asserts the root
// is unknown, read it straight back out and pass for the wrong reason. Cleared
// between tests so each starts from a cold cache; a test that wants to exercise
// the warm path warms it itself.
afterEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    // No storage in this environment, which is the cold state anyway.
  }
});

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

// jsdom 30 implements <dialog> as an element but not its modal METHODS — there
// is no `showModal` and no `close`. The element is baseline in every browser
// since 2022, so this is a gap in the test environment rather than a reason to
// hand-build an overlay and lose the focus trap, the Escape key and the inert
// backdrop that come with it.
//
// The shim reproduces only what a test can meaningfully assert: `open` flips,
// and `close` fires a `close` event so a component that syncs its state from
// that event is exercised on the same path the browser drives. It does NOT
// simulate focus trapping — nothing here should be read as proof of it.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  const open = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.showModal = open;
  HTMLDialogElement.prototype.show = open;
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}
