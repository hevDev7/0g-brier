import {MockSource} from "./mock";
import type {DataMode, DataSource} from "./types";

/**
 * F0 hanya punya MockSource. ChainSource (F1) dan IndexerSource (F4) masuk di
 * sini; IndexerSource akan MEMBUNGKUS ChainSource, bukan menduplikasinya,
 * sehingga "kuotasi selalu dari rantai" jadi sifat struktural.
 */
export function getDataSource(): DataSource {
  const mode = (process.env.NEXT_PUBLIC_DATA_MODE ?? "mock") as DataMode;
  if (mode !== "mock") {
    throw new Error(`DATA_MODE=${mode} belum diimplementasikan; F0 hanya mendukung "mock"`);
  }
  return new MockSource();
}

export * from "./types";
