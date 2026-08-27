import * as matchers from "@testing-library/jest-dom/matchers";
import type {TestingLibraryMatchers} from "@testing-library/jest-dom/matchers";
import {expect} from "vitest";

// Bukan `import "@testing-library/jest-dom/vitest"` (biasa dipakai): berkas itu
// mengimpor `expect` dari 'vitest' miliknya sendiri, yang di-resolve dari lokasi
// paket jest-dom (di-hoist ke node_modules akar workspace, tempat vitest@3 hidup
// untuk packages/protocol) — bukan dari `expect` milik frontend (vitest@4, di-nest
// di frontend/node_modules karena rentang versinya bentrok dengan protocol).
// Dua instance modul 'vitest' yang berbeda berarti dua registry Chai yang
// berbeda: matcher ter-daftar di salah satu, tapi test file memakai yang lain.
// Mengimpor matcher mentah lalu extend `expect` yang di-resolve dari sini
// (frontend/) menjamin keduanya memakai instance vitest yang sama.
expect.extend(matchers);

// Augmentasi tipe yang sama harus dideklarasikan dari SINI (frontend/), bukan
// diimpor dari `@testing-library/jest-dom/vitest`, dengan alasan yang identik:
// `declare module "vitest"` di berkas itu me-resolve 'vitest' dari lokasi paket
// jest-dom (root), yang menimpa tipe vitest@3 — bukan vitest@4 milik frontend
// yang dipakai berkas uji. Dideklarasikan di sini, "vitest" me-resolve ke
// frontend/node_modules/vitest, tipe yang sama yang dipakai berkas uji.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type --
   Bentuk ini identik dengan types/vitest.d.ts resmi @testing-library/jest-dom: interface kosong
   yang meng-extend TestingLibraryMatchers ADALAH cara sah menambahkan matcher ke Assertion lewat
   declaration merging. `any` di sini wajib: parameter generik pertama TestingLibraryMatchers
   diketik `any` di seluruh definisi jest-dom sendiri, dan default `T = any` harus sama persis
   dengan deklarasi asli Assertion di @vitest/expect agar TypeScript mau menggabungkannya. */
declare module "vitest" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
