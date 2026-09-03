/**
 * Environment in, a configured client out — and a refusal wherever the answer
 * would have to be a guess.
 *
 * Commit f443fd8 in this repository deleted a `?? "galileo"` from the inference
 * client because it put a mainnet agent's inference on a superseded testnet and
 * nothing threw: both halves succeed on their own, and the two provider
 * catalogues are disjoint. `modeForChainId` in `@0g-brier/protocol` had already
 * taken the same position for chain ids, and says so in its own error message —
 * the guess it replaced was localhost, which "looks like an empty protocol
 * rather than a misconfiguration".
 *
 * This file holds that line for a trader, where the same shape costs money
 * rather than a wrong answer:
 *
 *   - `CHAIN_ID` is REQUIRED. There is no default chain.
 *   - The RPC is DERIVED from the chain id unless one is given, so the two
 *     cannot disagree by construction — and it is then checked against what the
 *     endpoint actually reports, because a URL can point anywhere.
 *   - Contract addresses come from `deployments/<chainId>.json`. They may be
 *     overridden from the environment, and when both exist and disagree this
 *     refuses rather than picking one.
 *
 * `scripts/keeper-tick.sh` derives its chain id the same way and gives the
 * reason: "A keeper pointed at one chain while believing another is the worst
 * shape this script can take." A trader pointed the wrong way is worse — the
 * keeper only ever spends gas.
 *
 * THE PRIVATE KEY IS NOT A FIELD OF `AgentConfig`. It is read once, inside
 * `connect`, and handed straight to the SDK. A config object is the thing
 * people print when a run misbehaves.
 */
import {createPublicClient, formatUnits, http, parseUnits} from "viem";
import {BrierClient} from "@0g-brier/agent-kit";
import {modeForChainId, networkForChainId, type ChainMode} from "@0g-brier/protocol";
import {loadDeployment} from "@0g-brier/protocol/node";
import {fileURLToPath} from "node:url";

export type Env = Record<string, string | undefined>;

/**
 * Shape only, the same check `parseDeployment` makes in `@0g-brier/protocol`.
 *
 * Deliberately not EIP-55: `deployments/16661.json` is written all lowercase and
 * `deployments/16602.json` is written checksummed, so a checksum rule would
 * reject one of this repository's own manifests depending on which chain you
 * pointed at.
 */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** 0x + 64 hex. The `0x` is optional on input, as it is in every script here. */
const KEY_RE = /^[0-9a-fA-F]{64}$/;
/** A plain decimal amount, e.g. `1`, `0.25`. Not scientific notation. */
const DECIMAL_RE = /^\d+(\.\d+)?$/;

export interface AgentConfig {
  /** From `CHAIN_ID`. Never defaulted — see the file note. */
  chainId: number;
  /** `modeForChainId(chainId)`. Throws on a chain id it does not know. */
  network: ChainMode;
  /** `RPC_URL`, or the canonical endpoint for `network`. Verified, either way. */
  rpcUrl: string;
  factory: `0x${string}`;
  outcomeShares: `0x${string}`;
  /** The 0G Storage indexer for this network, or `null` where there is none (anvil). */
  indexerUrl: string | null;
  /** Where the addresses came from, so the report can say. */
  addressSource: "manifest" | "environment";
  /** True when this run may not sign anything. The client is built without a key. */
  dryRun: boolean;
  /**
   * `DRY_BUDGET`, kept as the decimal string it was written as.
   *
   * Collateral decimals are a property of the MARKET — 6 for the mock USDC on
   * Galileo, 18 for W0G on mainnet — and are not known until one has been read.
   * Parsing here would need a guess at them, and this file does not guess. Use
   * `dryBudgetTokens` once a market is in hand.
   *
   * `null` outside a dry run, where the balance is measured instead.
   */
  dryBudget: string | null;
  /** Never move the implied probability further than this in one order. */
  maxImpactBps: bigint;
  /** The return the trade must still show AFTER its own impact and fee. */
  minEdgeBps: bigint;
  /** Headroom over the chain's own quote, as the `maxTokensIn` bound. */
  slippageBps: bigint;
  /** A ceiling on Kelly. Kelly sizes against the bankroll and knows nothing else. */
  bankrollCapBps: bigint;
  /** `MARKET`: consider only this one. `null` scans every Open market. */
  onlyMarket: `0x${string}` | null;
}

/**
 * `--dry` folded into the environment.
 *
 * The `dry` npm script cannot be written `DRY_RUN=1 tsx …`: that is shell
 * syntax and does not run on Windows, and a starting point that only starts on
 * two thirds of machines is not one. The flag and the variable mean the same
 * thing; either is enough.
 */
export function envWithArgv(env: Env = process.env, argv: readonly string[] = process.argv): Env {
  if (!argv.includes("--dry")) return env;
  return {...env, DRY_RUN: "1"};
}

/**
 * Environment to config. Pure: no network, no clock, no filesystem beyond the
 * deployment manifest.
 *
 * Everything it cannot answer becomes a throw naming the variable that would
 * have answered it.
 */
/**
 * What the caller intends to do, so config can demand only what that needs.
 *
 * `sizesOrders: false` is `redeem.ts`. A dry run there previews CLAIMS, which are
 * whatever the chain already owes — there is no order to size, so demanding
 * DRY_BUDGET aborted the documented `npm run redeem -- --dry` before it connected,
 * with an error about having "no balance to size against" in a program that never
 * sizes anything. A developer's first redeem after their first fill hit it.
 */
export interface ConfigIntent {
  /** True when the caller builds orders and therefore needs a dry-run budget. */
  sizesOrders?: boolean;
}

export function readConfig(env: Env = process.env, intent: ConfigIntent = {}): AgentConfig {
  const dryRun = isTruthy(env.DRY_RUN);

  const rawChainId = env.CHAIN_ID;
  if (rawChainId === undefined || rawChainId === "") {
    throw new Error(
      "CHAIN_ID is required. There is no default: 16661 is 0G mainnet and 16602 is " +
        "Galileo, and an agent that picked one of them for you would trade real " +
        "collateral on whichever it guessed. See .env.example.",
    );
  }
  const chainId = Number(rawChainId);
  if (!Number.isInteger(chainId)) {
    throw new Error(`CHAIN_ID="${rawChainId}" is not an integer`);
  }
  // Throws by name on an unknown chain, which is the whole point of the helper.
  const network = modeForChainId(chainId);
  const net = networkForChainId(chainId, env);

  // DERIVED, not defaulted. `networkForChainId` answers from the chain id, so an
  // unset RPC_URL cannot point somewhere the chain id disagrees with. An RPC_URL
  // that IS set can point anywhere at all, which is what `assertChainMatches` is
  // for.
  const rpcUrl = nonEmpty(env.RPC_URL) ?? net.rpcUrl;

  const {factory, outcomeShares, addressSource} = readAddresses(chainId, env);

  // Validated here rather than in `connect`, so a missing key fails before the
  // first RPC round trip rather than after four of them. The value is read and
  // discarded — it does not enter the returned object.
  if (!dryRun) readKey(env);

  const sizesOrders = intent.sizesOrders ?? true;
  const dryBudget = dryRun && sizesOrders ? requireDryBudget(env) : null;

  return {
    chainId,
    network,
    rpcUrl,
    factory,
    outcomeShares,
    indexerUrl: net.indexerUrl,
    addressSource,
    dryRun,
    dryBudget,
    // 5 percentage points, as in `packages/agent-kit/examples/trade.ts` and the
    // worked example in `sizeWithinImpact`'s own documentation. It is a policy
    // number, which is why it is here and overridable rather than inline.
    maxImpactBps: readBps(env, "MAX_IMPACT_BPS", 500n),
    // Zero, and that is a derivation rather than a shrug. `Preview.tokensIn` is
    // gross — the fee is already inside it — and `payoutPerShareAfterWad` is
    // already the diluted prize. An expected value above that cost is therefore
    // above break-even with nothing left to subtract. Raise it to demand a
    // margin on top; there is nothing to add back.
    minEdgeBps: readBps(env, "MIN_EDGE_BPS", 0n),
    // 1% over the chain's quote, as in `examples/trade.ts`.
    slippageBps: readBps(env, "SLIPPAGE_BPS", 100n),
    // A quarter of free collateral, the cap `examples/trade.ts` puts on Kelly.
    bankrollCapBps: readBps(env, "BANKROLL_CAP_BPS", 2500n),
    onlyMarket: readOptionalAddress(env, "MARKET"),
  };
}

/**
 * The one network call this module makes: prove the endpoint is the chain the
 * config believes it is.
 *
 * A derived RPC cannot disagree with its chain id, but a supplied one can, and
 * so can a proxy that was repointed after the URL was written down. Galileo has
 * already been reset onto a new chain id twice.
 */
export async function assertChainMatches(config: AgentConfig): Promise<void> {
  const probe = createPublicClient({transport: http(config.rpcUrl)});
  let reported: number;
  try {
    reported = await probe.getChainId();
  } catch (cause) {
    throw new Error(
      `could not read a chain id from ${config.rpcUrl}. Refusing to trade against an ` +
        "endpoint that has not identified itself.",
      {cause},
    );
  }
  if (reported !== config.chainId) {
    throw new Error(
      `CHAIN_ID is ${config.chainId} but ${config.rpcUrl} reports ${reported}. ` +
        "An agent acting on one chain while addressed to another is worse than one " +
        "that is down: every address it holds names a different contract there.",
    );
  }
}

export interface Connected {
  config: AgentConfig;
  client: BrierClient;
}

/** `readConfig`, then the chain check, then the client. What the entry points call. */
export async function connect(env: Env = envWithArgv(), intent: ConfigIntent = {}): Promise<Connected> {
  const config = readConfig(env, intent);
  await assertChainMatches(config);

  // A dry run gets the SDK's own read-only client, which refuses every write by
  // name. The alternative — a throwaway key — teaches the habit of pasting keys
  // into example projects, and one day the key is not a throwaway.
  //
  // Spread rather than `privateKey: undefined`, because `exactOptionalPropertyTypes`
  // is on in this project's tsconfig and an explicit `undefined` is not the same
  // thing as an absent property under it.
  const key = config.dryRun ? null : readKey(env);
  const client = new BrierClient({
    network: config.network,
    factory: config.factory,
    outcomeShares: config.outcomeShares,
    rpcUrl: config.rpcUrl,
    ...(key === null ? {} : {privateKey: key}),
  });
  return {config, client};
}

/**
 * The dry-run budget in one market's collateral units.
 *
 * A read-only client has no wallet, so there is no balance to read; the number
 * a dry run sizes against is the one the operator stated. Reported as `config`
 * rather than `wallet` everywhere it is printed, so nobody reads a hypothetical
 * as a measurement.
 */
export function dryBudgetTokens(config: AgentConfig, decimals: number): bigint {
  if (config.dryBudget === null) {
    throw new Error("dryBudgetTokens called outside a dry run");
  }
  return parseUnits(config.dryBudget, decimals);
}

// ── reporting ───────────────────────────────────────────────────────────────
//
// One home for the formatters, because the two entry points print the same
// quantities and this project's worst reporting bug was two places disagreeing
// about what a number meant: dividing redeem proceeds by the tradable balance
// alone printed an implied rate of 21.01× for a market whose rate was 1.3689×.

/** A wad probability as a percentage. Only ever applied to `impliedProbability*`. */
export const pct = (wad: bigint): string => `${(Number(wad) / 1e16).toFixed(2)}%`;

/** A wad ratio — a marginal price, or a payout per share — as a multiple. */
export const times = (wad: bigint): string => `${(Number(wad) / 1e18).toFixed(4)}×`;

/** Basis points of PROBABILITY, which are percentage points of it. */
export const pp = (bps: bigint): string => `${(Number(bps) / 100).toFixed(2)}pp`;

/** Basis points of RETURN, which are a percentage of the stake. */
export const rate = (bps: bigint): string => `${(Number(bps) / 100).toFixed(2)}%`;

/** Collateral, in its own decimals. Never assume 18: mock USDC has 6. */
export const tokenAmount = (value: bigint, decimals: number): string => formatUnits(value, decimals);

/** Wad shares, which are always 18 decimals whatever the collateral is. */
export const shareAmount = (wad: bigint): string => formatUnits(wad, 18);

/** `0x1234…cdef`, for a report that has to fit on a line. */
export const short = (address: `0x${string}`): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

// ── internals ───────────────────────────────────────────────────────────────

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * The agent's key, normalised, never stored and never echoed.
 *
 * The error deliberately says nothing about what was found. A message that
 * quoted the offending value to be helpful would put a key — possibly a real
 * one, mistyped by one character — into a terminal, a CI log and a transcript.
 */
function readKey(env: Env): `0x${string}` {
  const raw = nonEmpty(env.AGENT_KEY);
  if (raw === null) {
    throw new Error(
      "AGENT_KEY is required to trade. Run with --dry (or DRY_RUN=1) to scan and " +
        "report without signing anything — that path builds a read-only client and " +
        "needs no key at all.",
    );
  }
  const body = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!KEY_RE.test(body)) {
    throw new Error("AGENT_KEY is not a private key: expected 0x followed by 64 hex characters.");
  }
  return `0x${body}`;
}

function requireDryBudget(env: Env): string {
  const raw = nonEmpty(env.DRY_BUDGET);
  if (raw === null) {
    throw new Error(
      "DRY_BUDGET is required in a dry run. The read-only client has no wallet, so " +
        "there is no balance to size against, and sizing against zero would report " +
        "'no room' on every market and teach you nothing. Set it to the amount you " +
        "want the run to reason about, in collateral units — e.g. DRY_BUDGET=1.5.",
    );
  }
  if (!DECIMAL_RE.test(raw)) {
    throw new Error(`DRY_BUDGET="${raw}" is not a plain decimal amount, e.g. 1.5`);
  }
  return raw;
}

function readBps(env: Env, name: string, fallback: bigint): bigint {
  const raw = nonEmpty(env[name]);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name}="${raw}" is not a whole number of basis points`);
  const value = BigInt(raw);
  if (value > 10_000n) throw new Error(`${name}=${raw} is more than 100% (10000 bps)`);
  return value;
}

function readOptionalAddress(env: Env, name: string): `0x${string}` | null {
  const raw = nonEmpty(env[name]);
  if (raw === null) return null;
  if (!ADDRESS_RE.test(raw)) throw new Error(`${name}="${raw}" is not an address`);
  return raw as `0x${string}`;
}

/**
 * Where the contracts are, from the manifest or from the environment.
 *
 * The manifest is the source of truth in this repository; the environment is
 * how a copied-out project names contracts with no `deployments/` directory to
 * read. When both are present and they disagree, this refuses — for the reason
 * `keeper-tick.sh` gives about chain ids. Two sources of truth that disagree is
 * the worst shape available, and picking one silently is how a run ends up
 * quoting one deployment and signing against another.
 */
function readAddresses(
  chainId: number,
  env: Env,
): {factory: `0x${string}`; outcomeShares: `0x${string}`; addressSource: "manifest" | "environment"} {
  const fromEnv = {
    factory: readOptionalAddress(env, "FACTORY"),
    outcomeShares: readOptionalAddress(env, "OUTCOME_SHARES"),
  };
  if ((fromEnv.factory === null) !== (fromEnv.outcomeShares === null)) {
    throw new Error(
      "FACTORY and OUTCOME_SHARES must be set together or not at all. Half an " +
        "override is a deployment mixed with another one.",
    );
  }

  const manifest = tryLoadManifest(chainId, env);

  if (fromEnv.factory !== null && fromEnv.outcomeShares !== null) {
    if (manifest !== null) {
      assertAgrees(manifest.factory, fromEnv.factory, "MarketFactory", "FACTORY", chainId);
      assertAgrees(manifest.outcomeShares, fromEnv.outcomeShares, "OutcomeShares", "OUTCOME_SHARES", chainId);
    }
    return {factory: fromEnv.factory, outcomeShares: fromEnv.outcomeShares, addressSource: "environment"};
  }

  if (manifest === null) {
    throw new Error(
      `no deployment for chain ${chainId}. Either point DEPLOYMENTS_DIR at a directory ` +
        `holding ${chainId}.json, or set FACTORY and OUTCOME_SHARES — the addresses for ` +
        "0G mainnet are in .env.example.",
    );
  }
  return {...manifest, addressSource: "manifest"};
}

function assertAgrees(
  fromManifest: `0x${string}`,
  fromEnv: `0x${string}`,
  contract: string,
  variable: string,
  chainId: number,
): void {
  if (fromManifest.toLowerCase() === fromEnv.toLowerCase()) return;
  throw new Error(
    `${variable}=${fromEnv} disagrees with deployments/${chainId}.json, which names ` +
      `${contract} at ${fromManifest}. Refusing to choose: one of the two is a ` +
      "superseded deployment, and quoting one while signing against the other is not " +
      "an error either of them would report. Clear the variable to use the manifest.",
  );
}

function tryLoadManifest(
  chainId: number,
  env: Env,
): {factory: `0x${string}`; outcomeShares: `0x${string}`} | null {
  // Relative to this file, so `npm run agent` works from anywhere in the repo.
  // A copied-out project has no such directory and is expected to use FACTORY
  // and OUTCOME_SHARES instead.
  // `fileURLToPath`, never `.pathname`: the latter stays percent-encoded (a clone
  // into `~/My Projects/` resolves to `%20` and the manifest "goes missing" while
  // sitting there) and keeps a leading slash before a Windows drive letter. This
  // project targets Windows deliberately — the `--dry` FLAG exists because
  // `DRY_RUN=1 tsx …` is shell syntax that does not run there.
  const dir = nonEmpty(env.DEPLOYMENTS_DIR) ?? fileURLToPath(new URL("../../deployments", import.meta.url));
  let manifest;
  try {
    manifest = loadDeployment(chainId, dir);
  } catch {
    // Absent or unparseable. The caller decides whether that is fatal, because
    // it is not fatal when FACTORY and OUTCOME_SHARES are set.
    return null;
  }
  const factory = manifest.contracts.MarketFactory;
  const outcomeShares = manifest.contracts.OutcomeShares;
  if (factory === undefined || outcomeShares === undefined) {
    throw new Error(
      `deployments/${chainId}.json is missing MarketFactory or OutcomeShares. ` +
        "A partial manifest is a broken deployment, not a reason to fall back.",
    );
  }
  return {factory, outcomeShares};
}
