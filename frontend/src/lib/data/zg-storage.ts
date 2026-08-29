import type {Hex} from "viem";
import {ZgStore as VerifiedStore} from "@hevdev7/zg-storage";
import type {Outcome, ResolverVote, SettlementReceipt, SpecSource} from "./types";

/**
 * The documents a market commits to, parsed out of verified 0G Storage bytes.
 *
 * The fetching and the Merkle verification live in `@hevdev7/zg-storage`,
 * shared with the agent SDK — an agent reading a market's question needs exactly
 * the same proof this page does. What stays here is the parsing, because a
 * MarketSpec and a settlement receipt are shapes this application knows and a
 * storage client has no business knowing.
 */

export {zgMerkleRoot, SpecRootMismatchError} from "@hevdev7/zg-storage";
export type {SpecSource};

const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * The document a market's `specRoot` commits to.
 *
 * Only the fields the CHAIN cannot answer are read from here. `category`,
 * `tier`, `tradingEnd` and `settlementDeadline` are also in the document, but
 * the on-chain values are the ones that bind, so the UI takes those and ignores
 * these — a document that disagrees with its own market must not be able to
 * change what the market is by saying so.
 */
export interface MarketSpec {
  version: number;
  question: string;
  rules: string;
  sources: readonly SpecSource[];
  settlementPrompt: string | null;
}


function parseSpec(json: unknown): MarketSpec | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const question = asString(o.question);
  const rules = asString(o.rules);
  // A document that verified against the root but carries no question is the
  // creator's doing, not a fault here — and there is still nothing to show, so
  // it lands in the same place as a document that was never uploaded.
  if (question === null || rules === null) return null;
  const sources = Array.isArray(o.sources)
    ? o.sources.flatMap((s): SpecSource[] => {
        if (typeof s !== "object" || s === null) return [];
        const e = s as Record<string, unknown>;
        const url = asString(e.url);
        if (url === null) return [];
        return [{kind: asString(e.kind) ?? "http", url, selector: asString(e.selector)}];
      })
    : [];
  return {
    version: typeof o.version === "number" ? o.version : 1,
    question,
    rules,
    sources,
    settlementPrompt: asString(o.settlementPrompt),
  };
}

/**
 * A settlement receipt (spec §7.5) as the UI needs it.
 *
 * The document's own shape is the resolver's; this maps it onto the fields the
 * report renders, and refuses to invent the ones it does not carry:
 *
 * - `votes` is EMPTY when no model was consulted. Not one entry with a blank
 *   name — an empty committee and a committee whose member has no name are
 *   different facts, and only the first is true of a receipt with `route:
 *   "none"`.
 * - `criteria` stays null unless the RESOLVER stated some. The market's promised
 *   criteria are in its MarketSpec and are shown separately; copying them in
 *   here would make the report agree with itself by construction.
 * - `simulated` defaults to TRUE when the document does not say. A receipt that
 *   forgot to declare itself real must not be read as real.
 */
function parseReceipt(json: unknown): SettlementReceipt | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const inference = (typeof o.inference === "object" && o.inference !== null ? o.inference : {}) as Record<
    string,
    unknown
  >;

  const outcome = o.outcome === "YES" ? 1 : o.outcome === "NO" ? 0 : null;
  const reasoning = asString(o.rationale);
  // A receipt with no rationale explains nothing, and the panel's whole promise
  // is that the reasoning is there to read verbatim.
  if (reasoning === null) return null;

  const model = asString(inference.model);
  const teeVerified = inference.teeVerified === true;
  const simulated = inference.simulated !== false;
  const votes: ResolverVote[] =
    model === null ? [] : [{model, outcome: outcome as Outcome | null, teeVerified, simulated}];

  const sources = Array.isArray(o.evidence)
    ? o.evidence.flatMap((e): string[] => {
        if (typeof e !== "object" || e === null) return [];
        const url = asString((e as Record<string, unknown>).url);
        return url === null ? [] : [url];
      })
    : [];

  const provider = asString(inference.providerAddress);
  return {
    // FALSE unless the chain says otherwise, and the chain is read separately.
    // This document is written by whoever settled the market, so letting it
    // declare itself a committee decision would make the flag worth nothing.
    viaCommittee: false,
    outcome: outcome as Outcome | null,
    votes,
    judgeModel: model,
    reasoning,
    criteria: asString(o.criteria),
    sources,
    provider: (provider !== null && /^0x[0-9a-fA-F]{40}$/.test(provider)
      ? provider
      : "0x0000000000000000000000000000000000000000") as `0x${string}`,
    chatId: asString(inference.chatID),
    route: asString(inference.route),
    simulated,
  };
}


/**
 * Adds the document shapes to the verified store.
 *
 * `get` returns whatever JSON was proven to sit at a root; these two say what
 * this application will do with it.
 */
export class ZgStore extends VerifiedStore {
  async getSpec(root: Hex): Promise<MarketSpec | null> {
    return parseSpec(await this.get(root));
  }

  async getReceipt(root: Hex): Promise<SettlementReceipt | null> {
    return parseReceipt(await this.get(root));
  }
}
