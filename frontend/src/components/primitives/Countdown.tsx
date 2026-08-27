"use client";
import {useEffect, useState} from "react";
import {formatCountdown} from "@/lib/format";

/**
 * `nowSeconds` disuntik agar bisa diuji secara deterministik; bila ada, efek di
 * bawah dilewati sepenuhnya.
 *
 * Tanpa suntikan itu jam dinding dibaca di EFEK, bukan saat render. Membacanya
 * saat render melanggar `react-hooks/purity` — dan bukan karena aturan lint yang
 * cerewet: hasil render jadi bergantung pada kapan ia dipanggil, sehingga server
 * dan klien bisa menghasilkan angka berbeda untuk masukan yang sama.
 *
 * Sebelum efeknya jalan, komponen ini merender elipsis, bukan angka. Server
 * memang TIDAK TAHU jam pembaca, dan menebaknya berarti menampilkan hitungan
 * mundur yang salah lalu memperbaikinya diam-diam.
 */
export function Countdown({until, nowSeconds}: {until: number; nowSeconds?: number}) {
  const [now, setNow] = useState<number | null>(nowSeconds ?? null);

  useEffect(() => {
    if (nowSeconds !== undefined) return;
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    // Granularitas tampilannya menit, jadi 30 detik sudah lebih dari cukup.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [nowSeconds]);

  return <span>{now === null ? "…" : formatCountdown(until - now)}</span>;
}
