import {MockSource} from "./mock";
import type {DataMode, DataSource} from "./types";

/**
 * F0 has only MockSource. ChainSource (F1) and IndexerSource (F4) plug in here;
 * IndexerSource will WRAP ChainSource rather than duplicate it, which makes
 * "quotes always come from the chain" a structural property.
 */
export function getDataSource(): DataSource {
  const mode = (process.env.NEXT_PUBLIC_DATA_MODE ?? "mock") as DataMode;
  if (mode !== "mock") {
    throw new Error(`DATA_MODE=${mode} is not implemented yet; F0 supports only "mock"`);
  }
  return new MockSource();
}

export * from "./types";
