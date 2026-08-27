import type {UseQueryResult} from "@tanstack/react-query";
import {CapabilityUnavailableError, type Query} from "@/lib/data/types";

/**
 * Menerjemahkan keadaan TanStack jadi union kita, dengan `unavailable` sebagai
 * cabang tersendiri.
 *
 * Perhatikan mode TIDAK diterima sebagai parameter. Ia diambil dari error yang
 * dilempar, dan itu bukan penghematan melainkan koreksi: `CapabilityUnavailableError`
 * membawa mode LAPISAN YANG BENAR-BENAR TIDAK BISA MENJAWAB. Ketika `IndexerSource`
 * membungkus `ChainSource`, mode pemanggil dan mode yang gagal bisa berbeda —
 * dan yang berhak disebut ke pengguna adalah yang gagal.
 */
export function toQuery<T>(result: UseQueryResult<T>): Query<T> {
  if (result.isPending) return {status: "loading"};
  if (result.error) {
    const error = result.error;
    if (error instanceof CapabilityUnavailableError) {
      return {status: "unavailable", capability: error.capability, mode: error.mode};
    }
    return {status: "error", error: error as Error};
  }
  return {status: "ready", data: result.data as T};
}
