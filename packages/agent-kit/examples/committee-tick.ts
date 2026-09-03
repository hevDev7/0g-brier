/**
 * One committee pass, doing the vote the clock has made due.
 *
 *   CHAIN_ID=16661 npx tsx examples/committee-tick.ts             — act
 *   CHAIN_ID=16661 DRY_RUN=1 npx tsx examples/committee-tick.ts   — report, send nothing
 *
 * WHY THIS EXISTS. Market 0xCDc13Cc2830240518ce76a0a6ecbA51a4DBA8c35 on mainnet
 * went Open → Closed → Failed with commits=0 and reveals=0. Nobody voted, because
 * nothing was ever scheduled to vote: the three programs that can — this package's
 * `resolve.ts`, `scripts/committee-run.mjs` and `scripts/rehearse-resolution.mjs` —
 * are manual one-shots, and no timer, unit or cron referenced any of them. The
 * keeper printed "1 market(s) need a resolver, which this keeper is not" seven
 * times into a journal with no consumer, three sampled resolvers were never
 * slashed because they never appeared at all, and every holder exited at their
 * own price on a question the chain could have answered.
 *
 * WHY IT IS NOT `committee-run.mjs` UNDER A TIMER. That script blocks in
 * `sleep()` until the commit deadline and again until the dispute deadline —
 * three hours for a DETERMINISTIC market, about seven for a VERIFIED one. Under
 * any `TimeoutStartSec` a scheduler can honestly set it is killed halfway, and
 * what it leaves behind is the one outcome that actually costs stake: a commit on
 * chain with no reveal against it.
 *
 * A PASS, NOT A DAEMON — the same doctrine as `examples/keeper.ts`, and for the
 * same reasons. Each pass does AT MOST ONE PHASE per market and exits; it prints
 * `next-due <unix>` last, which `scripts/committee-tick.sh` turns into a one-shot
 * timer. Every action re-checks its precondition against live chain state
 * immediately before sending, so two overlapping passes cannot both act.
 *
 * TWO THINGS IT WILL NOT DO
 *
 *  1. IT WILL NOT VOTE BEFORE THE EVENT IS DECIDABLE. The market's own spec says
 *     when its question becomes answerable — `resolvesBy` — and until that instant
 *     a committed outcome is a guess wearing a receipt. Per spec §7.4 abstaining
 *     beats guessing, so the pass defers instead. Where the round's reveal window
 *     shuts BEFORE `resolvesBy`, no honest vote exists in it at all: that is the
 *     incident above, and the pass names it rather than voting anyway.
 *  2. IT WILL NOT COMMIT AN UNATTESTED ANSWER. §7.4 again, and `resolve.ts`
 *     documents it: an answer no enclave vouched for is not evidence, so it falls
 *     through to UNRESOLVABLE.
 *
 * WHAT IT NEEDS THAT `resolve.ts` DID NOT. `resolve.ts` holds commit and reveal in
 * one process, so it keeps the vote in a local variable across the hour between
 * them. A pass cannot: the commit happens in one run and the reveal in a later
 * one, and the commitment binds `(market, outcome, salt, receiptRoot, operator)`.
 * The salt is derivable — see `saltFor` — but the outcome and the receipt root are
 * not: re-running the enclave gives a different rationale and therefore a
 * different document at a different root, which reveals as `BadCommitment`. So a
 * vote is journalled to disk BEFORE its commit is sent, and the reveal reads it
 * back. Losing that file makes an outstanding commit unrevealable and the
 * resolver is slashed as a no-show — see `JOURNAL` for where it lives.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbiParameters,
  toHex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {loadDeployment} from "@0g-brier/protocol/node";
import {modeForChainId, networkForChainId} from "@0g-brier/protocol";
import {ZgStore} from "@0g-brier/zg-storage";
import {
  BrierClient,
  ZgInference,
  gatherEvidence,
  observedIndices,
  receiptEvidence,
  renderObservation,
  suggestFees,
  type Judgement,
  type Observation,
} from "../src/index";
import {execFileSync} from "node:child_process";
import {chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

// ── the phase logic ─────────────────────────────────────────────────────────
// Pure, exported, and the only part of this file a test can reach without a
// chain: everything below it needs an RPC, a storage indexer and a funded
// compute ledger. `test/committee-tick.test.ts` is that test.

/** Outcome codes as `Outcomes.sol` numbers them. `NONE` is the absence of a vote. */
export const NO = 0;
export const YES = 1;
export const UNRESOLVABLE = 2;
export const NONE = 3;

/**
 * One second past a deadline, never on it.
 *
 * Every gate in `ResolutionModule` is strict: `revealVote` demands
 * `block.timestamp > commitDeadline`, `finalize` demands `> disputeDeadline`, and
 * both revert on equality — `WindowOpen` and `TooEarly` respectively. A wake
 * scheduled AT a deadline is therefore a wake that pays gas to be refused. This
 * is not a tolerance and not a guess; it is those two `>` written out, and it is
 * the smallest step the chain's second-resolution clock has.
 */
const AFTER = 1;

/**
 * How long to wait before looking again for a committee somebody else must draw.
 *
 * The draw is the keeper's transaction, and nothing on chain says when it will
 * land — so unlike every other wake in this file there is no deadline to sleep
 * to. Five minutes is short against the COMMIT_WINDOW of 3600 s it opens (the
 * live mainnet value), so a pass still lands well inside the window it must vote
 * in, and long enough that waiting for a keeper is not a spin loop.
 */
export const DRAW_RECHECK_SECONDS = 300;

/** `ResolutionModule.roundOf`, as far as this pass cares. */
export interface RoundState {
  /** Committee size. ZERO means no committee has been drawn yet. */
  n: number;
  /** Votes for one outcome needed to propose it. */
  k: number;
  /** 1 for the first round, 2 for a dispute round, 0 when nothing is open. */
  index: number;
  /** `NONE` until a reveal meets the threshold. */
  proposedOutcome: number;
  commitDeadline: number;
  revealDeadline: number;
  /** Zero until a proposal exists — the module writes it on the reveal that meets `k`. */
  disputeDeadline: number;
  finalized: boolean;
}

/** One committee seat whose operator key this pass holds. */
export interface SeatState {
  agentId: number;
  committed: boolean;
  revealed: boolean;
}

export type Phase =
  /** The round is over. Nothing here will ever be due again. */
  | "done"
  /** Closed, but no committee has been drawn. Somebody else's transaction. */
  | "wait-for-draw"
  /** The reveal window shuts before the event is decidable. The incident. */
  | "unanswerable"
  /** The spec does not say when its question becomes answerable. */
  | "undecidable"
  /** Committed last pass, and the reveal window is open now. */
  | "reveal"
  /** The event has not happened yet. Voting now would be guessing. */
  | "wait-for-event"
  /** Decide and commit. */
  | "commit"
  /** A proposal stands and nobody can still object to it. */
  | "finalize"
  /** A proposal stands and the objection window is still running. */
  | "wait-for-finalize"
  /** The reveal window shut without `k` agreeing votes. Only the deadline can help now. */
  | "no-threshold"
  /** Nothing to do this pass, but the round is still live. */
  | "idle";

export interface Due {
  phase: Phase;
  /** The agent ids the phase applies to. Empty for every phase but commit and reveal. */
  seats: number[];
  /** Unix seconds, or null when nothing about this market can fall due again. */
  nextDue: number | null;
  /** One sentence, printed. Says which numbers decided it. */
  why: string;
}

/**
 * When `finalize` stops reverting `TooEarly`, or null when that is not yet knowable.
 *
 * NOT the reveal deadline for round one, and the difference has teeth: the module
 * refuses round one until `block.timestamp > disputeDeadline`, and the dispute
 * deadline is written only when a reveal first meets the threshold. Before that
 * moment it genuinely does not exist, and null is the honest answer — a caller
 * that substituted `revealDeadline` would schedule a wake for a call guaranteed
 * to revert. Round two has no dispute window and waits out its reveal window
 * instead, which is the module's way of denying its own members the choice of
 * when the market settles.
 */
export function finalizeDueAt(round: RoundState): number | null {
  if (round.proposedOutcome === NONE) return null;
  if (round.index === 2) return round.revealDeadline + AFTER;
  return round.disputeDeadline > 0 ? round.disputeDeadline + AFTER : null;
}

/** The earliest deadline of this round still ahead of `now`, or null if none is. */
function nextRoundDeadline(now: number, round: RoundState): number | null {
  const candidates = [round.commitDeadline + AFTER, round.revealDeadline + AFTER];
  const finalizeAt = finalizeDueAt(round);
  if (finalizeAt !== null) candidates.push(finalizeAt);
  const ahead = candidates.filter((t) => t > now).sort((a, b) => a - b);
  return ahead[0] ?? null;
}

/**
 * Which single phase this market makes due, and when to come back.
 *
 * ONE PHASE PER PASS, and the order below is the priority. Reveal outranks
 * everything the operator could otherwise do because it is the only step with
 * stake behind it: a commit that goes unrevealed is slashed, whereas a commit
 * this pass declines to make costs nothing but a seat. Finalize is
 * permissionless and can wait for the next pass; revealing cannot.
 */
export function phaseFor(input: {
  now: number;
  /** From the market's MarketSpec. Null when the document does not carry one. */
  resolvesBy: number | null;
  round: RoundState;
  /** Only the seats this operator can sign for. Empty when it was not drawn. */
  seats: readonly SeatState[];
}): Due {
  const {now, resolvesBy, round, seats} = input;

  if (round.finalized) {
    return {phase: "done", seats: [], nextDue: null, why: "the round is finalized"};
  }

  if (round.n === 0) {
    // Deferred to `resolvesBy` when that is still ahead, because the draw itself
    // must not happen before then — a committee seated early gets a commit window
    // that closes before its question can be answered, which is the whole incident.
    const nextDue = resolvesBy !== null && resolvesBy > now ? resolvesBy : now + DRAW_RECHECK_SECONDS;
    return {
      phase: "wait-for-draw",
      seats: [],
      nextDue,
      why: "no committee has been drawn; that is the keeper's transaction, not this one's",
    };
  }

  const toReveal = seats.filter((s) => s.committed && !s.revealed).map((s) => s.agentId);
  if (toReveal.length > 0 && now > round.commitDeadline && now <= round.revealDeadline) {
    return {
      phase: "reveal",
      seats: toReveal,
      // After revealing, the next thing that matters is finalizing — but the
      // dispute deadline may not exist yet, because this very reveal may be the
      // one that creates it. Coming back at the reveal deadline reads it then.
      nextDue: finalizeDueAt(round) ?? round.revealDeadline + AFTER,
      why: `${toReveal.length} seat(s) committed and not revealed, ${round.revealDeadline - now}s of window left`,
    };
  }

  // THE INCIDENT, detected rather than inferred.
  //
  // Measured against the COMMIT deadline, not the reveal one. The commit is the
  // binding act — the reveal only opens what was already sealed — so a window
  // that shuts before the event is decidable admits no honest vote from anybody,
  // and there is nothing to come back for. The incident's own market was past
  // both: commitDeadline 1788306133, revealDeadline 1788309733, resolvesBy
  // 1788316800.
  //
  // BELOW THE REVEAL, deliberately. An outstanding commit is stake at risk
  // whatever is wrong with the round it sits in, and a diagnostic that returned
  // first would starve the one action that stops a slashing.
  if (resolvesBy !== null && resolvesBy > round.commitDeadline && round.proposedOutcome === NONE) {
    return {
      phase: "unanswerable",
      seats: [],
      nextDue: null,
      why:
        `the commit window shuts at ${round.commitDeadline} and the event is not decidable until ` +
        `${resolvesBy}, ${resolvesBy - round.commitDeadline}s later — the committee was drawn too early`,
    };
  }

  const toCommit = seats.filter((s) => !s.committed).map((s) => s.agentId);
  if (toCommit.length > 0 && now <= round.commitDeadline) {
    if (resolvesBy === null) {
      // Nothing says when this question becomes answerable, so nothing can say
      // this vote would not be a guess. The market fails at its deadline and every
      // side exits at its own price, which is the cheaper of the two mistakes.
      return {
        phase: "undecidable",
        seats: [],
        nextDue: null,
        why: "the MarketSpec carries no resolvesBy, so nothing here can tell a decided event from an undecided one",
      };
    }
    if (now < resolvesBy) {
      return {
        phase: "wait-for-event",
        seats: [],
        nextDue: resolvesBy,
        why: `the event is not decidable for another ${resolvesBy - now}s`,
      };
    }
    return {
      phase: "commit",
      seats: toCommit,
      // The reveal opens strictly after the commit deadline, never on it.
      nextDue: round.commitDeadline + AFTER,
      why: `${toCommit.length} seat(s) to vote, ${round.commitDeadline - now}s of commit window left`,
    };
  }

  if (round.proposedOutcome !== NONE) {
    const finalizeAt = finalizeDueAt(round);
    if (finalizeAt !== null && now >= finalizeAt) {
      return {
        phase: "finalize",
        seats: [],
        nextDue: null,
        why: `outcome ${round.proposedOutcome} proposed and nobody can still object`,
      };
    }
    return {
      phase: "wait-for-finalize",
      seats: [],
      nextDue: finalizeAt,
      why: `outcome ${round.proposedOutcome} proposed; the objection window is still open`,
    };
  }

  if (now > round.revealDeadline) {
    return {
      phase: "no-threshold",
      seats: [],
      nextDue: null,
      why: `the reveal window shut at ${round.revealDeadline} without ${round.k} agreeing votes`,
    };
  }

  return {
    phase: "idle",
    seats: [],
    nextDue: nextRoundDeadline(now, round),
    why: "the round is live and this operator has nothing outstanding in it",
  };
}

// ── everything below here talks to a chain ──────────────────────────────────

const MODULE_ABI = [
  {
    type: "function",
    name: "roundOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "n", type: "uint8"},
          {name: "k", type: "uint8"},
          {name: "index", type: "uint8"},
          {name: "proposedOutcome", type: "uint8"},
          {name: "commitDeadline", type: "uint64"},
          {name: "revealDeadline", type: "uint64"},
          {name: "disputeDeadline", type: "uint64"},
          {name: "commits", type: "uint16"},
          {name: "reveals", type: "uint16"},
          {name: "finalized", type: "bool"},
        ],
      },
    ],
  },
  {type: "function", name: "committeeOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256[]"}]},
  {
    type: "function",
    name: "commitmentOf",
    stateMutability: "view",
    inputs: [{type: "address"}, {type: "uint256"}],
    outputs: [{type: "bytes32"}],
  },
  {
    type: "function",
    name: "revealOf",
    stateMutability: "view",
    inputs: [{type: "address"}, {type: "uint256"}],
    outputs: [{type: "uint8"}],
  },
  {
    type: "function",
    name: "commitVote",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}, {type: "uint256"}, {type: "bytes32"}],
    outputs: [],
  },
  {
    type: "function",
    name: "revealVote",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}, {type: "uint256"}, {type: "uint8"}, {type: "bytes32"}, {type: "bytes32"}],
    outputs: [],
  },
  {type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
] as const;

const REGISTRY_ABI = [
  {type: "function", name: "operatorOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "address"}]},
] as const;

const OUTCOME_NAMES = ["NO", "YES", "UNRESOLVABLE"];

/** What `commitmentOf` answers for a seat that has not committed. */
const NO_COMMITMENT = `0x${"00".repeat(32)}` as const;

/**
 * The vote a commit bound itself to, kept until its reveal can spend it.
 *
 * `commitment` is stored alongside the pre-image rather than recomputed on trust:
 * the reveal checks it against `commitmentOf` on chain before sending, so a
 * journal entry written by a different derivation — a different market-address
 * casing in the salt, say — is caught and reported instead of reverting
 * `BadCommitment` and costing the seat its stake anyway.
 */
interface VoteRecord {
  chainId: number;
  market: `0x${string}`;
  round: number;
  agentId: number;
  operator: `0x${string}`;
  outcome: number;
  salt: `0x${string}`;
  receiptRoot: `0x${string}`;
  commitment: `0x${string}`;
  committedAt: number;
}

/**
 * Where the journal lives.
 *
 * OUTSIDE THE REPO by default, for two reasons. It must survive a `git clean` and
 * a redeploy — an unrevealable commit is a slashing, not an inconvenience — and
 * it holds the PRE-IMAGE of a commitment, which is the one secret a commit-reveal
 * scheme has. A file under `$XDG_STATE_HOME` with mode 0600 is not security, but
 * it is at least not a vote published in a working tree an hour before its reveal.
 */
function journalPath(chainId: number): string {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return process.env.COMMITTEE_STATE_FILE ?? join(stateHome, "brier", `committee-votes-${chainId}.json`);
}

function journalKey(chainId: number, market: string, round: number, agentId: number): string {
  return `${chainId}:${market.toLowerCase()}:${round}:${agentId}`;
}

function readJournal(path: string): Record<string, VoteRecord> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, VoteRecord>;
  } catch {
    // Absent is the normal first run. Corrupt is not, but the recovery is the
    // same and the reveal path reports every seat it cannot find an entry for.
    return {};
  }
}

/**
 * Write-ahead, and atomically.
 *
 * The record goes to disk BEFORE `commitVote` is sent, because the failure that
 * matters is the other order: a commit mined into a block while the process that
 * knew its pre-image was killed by `TimeoutStartSec`. A stale entry for a commit
 * that never landed is harmless — the reveal re-reads `commitmentOf` and skips
 * what does not match. `rename` is what makes a kill mid-write leave the previous
 * journal intact rather than half of the new one.
 */
function appendJournal(path: string, key: string, record: VoteRecord): void {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const all = readJournal(path);
  all[key] = record;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2), {mode: 0o600});
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/**
 * `keccak256(abi.encode(deployerKey, "brier-resolver", index))`.
 *
 * ONE derivation, copied verbatim from `examples/resolve.ts`, which explains at
 * length why it is this one and not the two older schemes. It is repeated rather
 * than imported because `resolve.ts` is a script rather than a module: importing
 * it would run a whole resolution.
 */
function operatorKey(deployerKey: `0x${string}`, index: number): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, string, uint256"), [deployerKey, "brier-resolver", BigInt(index)]),
  );
}

/** Every operator key this deployer could hold, by the address it makes. See `resolve.ts`. */
function operatorCandidates(deployerKey: `0x${string}`): Map<string, `0x${string}`> {
  const byAddress = new Map<string, `0x${string}`>();
  const add = (k: `0x${string}`) => {
    const a = privateKeyToAccount(k).address.toLowerCase();
    if (!byAddress.has(a)) byAddress.set(a, k);
  };
  const bare = deployerKey.slice(2);
  for (let i = 0; i < 32; i++) {
    add(operatorKey(deployerKey, i));
    add(keccak256(`0x${bare}${i.toString(16).padEnd(64, "0")}` as `0x${string}`));
    add(keccak256(`0x${bare}${i.toString(16).padStart(64, "0")}` as `0x${string}`));
  }
  return byAddress;
}

/**
 * `keccak256("salt-<agentId>-<market>")`, the derivation `resolve.ts` and
 * `scripts/committee-run.mjs` both use.
 *
 * REPRODUCIBLE ACROSS PASSES, which is why it is derived rather than drawn at
 * random: a pass that generated a fresh salt would have to be believed by the
 * pass that reveals an hour later. It is journalled all the same, because the
 * market address is stringified here and a caller that spelled it in a different
 * case would derive a different salt for the same seat.
 */
function saltFor(agentId: bigint, market: `0x${string}`): `0x${string}` {
  return keccak256(toHex(`salt-${agentId}-${market}`));
}

function commitmentFor(market: `0x${string}`, outcome: number, salt: `0x${string}`, receiptRoot: `0x${string}`, operator: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{type: "address"}, {type: "uint8"}, {type: "bytes32"}, {type: "bytes32"}, {type: "address"}],
      [market, outcome, salt, receiptRoot, operator],
    ),
  );
}

/** The useful sentence out of a viem error, without the stack of ABI dumps. */
function reasonOf(err: unknown): string {
  const text = err instanceof Error ? ((err as {shortMessage?: string}).shortMessage ?? err.message) : String(err);
  return (text.split("\n")[0] ?? text).slice(0, 120);
}

async function main(): Promise<void> {
  // REQUIRED, not defaulted. `keeper.ts` still falls back to 16602 and that is a
  // wart it inherited; 0.2.2 shipped precisely because a defaulted network put a
  // mainnet deployment's inference on the testnet. A committee that votes on the
  // wrong chain is worse again: it finds no markets and reports a clean pass.
  const chainIdRaw = process.env.CHAIN_ID;
  if (!chainIdRaw) throw new Error("set CHAIN_ID — this pass will not guess which chain it votes on");
  const CHAIN_ID = Number(chainIdRaw);
  const DRY = process.env.DRY_RUN === "1";

  // The operator keys are DERIVED from this one, so it must be the seed the
  // resolvers were registered under — not a wallet of the pass's own, as the
  // keeper has.
  //
  // NO `?? DEPLOYER_KEY` FALLBACK, deliberately. On this deployment DEPLOYER_KEY
  // is still `owner()` of all four UUPS proxies and can upgrade any of them with
  // no timelock, so a silent fallback would put unilateral upgrade authority over
  // every contract onto an unattended timer — for a job that only ever needs to
  // sign commitVote and revealVote. keeper-tick.sh states the principle for its
  // own wallet: "a leaked keeper key costs the price of a few transactions and
  // nothing else." That property has to be bought explicitly here, because the
  // committee derivation cannot invent it.
  //
  // Naming COMMITTEE_KEY does not by itself make it a lesser key: where the
  // resolvers were derived from the deployer secret, setting it to that secret
  // restores the whole blast radius. The fix for that is to re-derive the
  // committee from a dedicated seed, which is an operator decision and a
  // re-registration, not something this pass may quietly assume.
  const rawKey = process.env.COMMITTEE_KEY;
  if (!rawKey) {
    throw new Error(
      "set COMMITTEE_KEY — the committee's operator keys are derived from it.\n" +
        "  It is NOT defaulted to DEPLOYER_KEY: that key owns every proxy on this\n" +
        "  deployment, and this pass runs unattended on a timer.",
    );
  }
  const KEY = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

  const net = networkForChainId(CHAIN_ID);
  const RPC = process.env.RPC_URL ?? net.rpcUrl;
  const indexerUrl = process.env.ZG_INDEXER ?? net.indexerUrl;
  if (indexerUrl === null) {
    throw new Error(
      `chain ${CHAIN_ID} has no 0G Storage indexer, and without one the MarketSpec — which is where ` +
        "resolvesBy lives — cannot be read. Set ZG_INDEXER, or run against 16661 or 16602.",
    );
  }
  const store = new ZgStore(indexerUrl);

  const REPO = new URL("../../../", import.meta.url).pathname;
  const manifest = loadDeployment(CHAIN_ID, `${REPO}deployments`);
  const MODULE = manifest.contracts.ResolutionModule as `0x${string}`;
  const REGISTRY = manifest.contracts.AgentRegistry as `0x${string}`;

  const chain = defineChain({
    id: CHAIN_ID,
    name: modeForChainId(CHAIN_ID),
    nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
    rpcUrls: {default: {http: [RPC]}},
  });
  const pub = createPublicClient({chain, transport: http(RPC)});
  const account = privateKeyToAccount(KEY);

  /** Sends from one operator's own wallet, then waits for a receipt by polling. */
  async function send(pk: `0x${string}`, functionName: "commitVote" | "revealVote" | "finalize", args: readonly unknown[]) {
    const signer = privateKeyToAccount(pk);
    const wallet = createWalletClient({account: signer, chain, transport: http(RPC)});
    const hash = await wallet.writeContract({
      address: MODULE,
      abi: MODULE_ABI,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one helper, three names
      functionName: functionName as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: args as any,
      account: signer,
      chain,
      ...(await suggestFees(pub)),
    });
    // Polled rather than watched, for the reason `keeper.ts` gives: 0G answers
    // block subscriptions unreliably and `waitForTransactionReceipt` has reported
    // a crash for a transaction that had already succeeded.
    const until = Date.now() + 120_000;
    for (;;) {
      try {
        const r = await pub.getTransactionReceipt({hash});
        // A receipt proves the transaction was MINED, not that it succeeded.
        if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
        return hash;
      } catch (e) {
        if (e instanceof Error && e.message.includes("reverted")) throw e;
        if (Date.now() > until) throw new Error(`${functionName}: no receipt for ${hash} after 120s`);
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  }

  /** Uploads through the repo's own uploader, so a receipt is stored the one way. */
  function storeReceipt(doc: unknown): `0x${string}` {
    const out = execFileSync("node", [`${REPO}scripts/upload-doc.mjs`], {
      input: JSON.stringify(doc),
      env: {...process.env, UPLOADER_KEY: KEY, CHAIN_ID: String(CHAIN_ID)},
      encoding: "utf8",
    });
    return out.trim() as `0x${string}`;
  }

  const client = new BrierClient({
    network: modeForChainId(CHAIN_ID),
    privateKey: KEY,
    factory: manifest.contracts.MarketFactory as `0x${string}`,
    outcomeShares: manifest.contracts.OutcomeShares as `0x${string}`,
  });

  const JOURNAL = journalPath(CHAIN_ID);
  const only = (process.env.MARKET ?? "").toLowerCase();
  const candidates = operatorCandidates(KEY);
  const providers = (process.env.ZG_PROVIDERS ?? process.env.ZG_PROVIDER ?? "0xa48f01287233509FD694a22Bf840225062E67836")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean) as `0x${string}`[];
  const brokers = new Map<string, ZgInference>();
  async function inferenceFor(provider: `0x${string}`): Promise<ZgInference> {
    let b = brokers.get(provider.toLowerCase());
    if (!b) {
      b = await ZgInference.connect({network: modeForChainId(CHAIN_ID), privateKey: KEY, provider});
      brokers.set(provider.toLowerCase(), b);
    }
    return b;
  }

  const now = Math.floor(Date.now() / 1000);
  const markets = await client.listMarkets();
  console.log(`committee     ${account.address}`);
  console.log(`              ${markets.length} market(s) on ${manifest.contracts.MarketFactory}${DRY ? "  ·  DRY RUN" : ""}`);
  console.log(`              journal ${JOURNAL}`);

  let committed = 0;
  let revealed = 0;
  let finalized = 0;
  const dueAt: number[] = [];

  for (const m of markets) {
    if (only && m.address.toLowerCase() !== only) continue;
    const short = `${m.address.slice(0, 10)}…`;

    // ONE MARKET'S BAD DAY MUST NOT TAKE THE REST OF THE PASS WITH IT. The
    // keeper learned this on `close()`: a throw part-way through the loop left
    // every market after it untouched, and the pass still exited looking like a
    // pass. An unreachable indexer, a reverted commit or a seat whose operator
    // has been de-registered are all one market's problem.
    try {
      // Only a market whose trading has ended can have a committee at all, and one
      // already Settled, Failed or Voided has nothing left to vote on.
      if (m.status === "Open") {
        dueAt.push(m.tradingEnd);
        console.log(`skip          ${short}  Open, ${Math.round((m.tradingEnd - now) / 60)} min of trading left`);
        continue;
      }
      if (m.status === "Settled" || m.status === "Failed" || m.status === "Voided") {
        console.log(`skip          ${short}  ${m.status}`);
        continue;
      }

      // `resolvesBy` — the field this whole pass turns on, and which until now was
      // read by nothing in the repo. Zero means the question resolves from the
      // market's own state (`market-spec.py` says so of the selftest category), so
      // it is answerable the moment trading ends.
      let resolvesBy: number | null = null;
      try {
        const spec = (await store.get(m.specRoot)) as {resolvesBy?: number} | null;
        if (typeof spec?.resolvesBy === "number") resolvesBy = spec.resolvesBy === 0 ? m.tradingEnd : spec.resolvesBy;
      } catch (err) {
        console.log(`warn          ${short}  could not read the MarketSpec — ${reasonOf(err)}`);
      }

      const raw = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "roundOf", args: [m.address]});
      const round: RoundState = {
        n: raw.n,
        k: raw.k,
        index: raw.index,
        proposedOutcome: raw.proposedOutcome,
        commitDeadline: Number(raw.commitDeadline),
        revealDeadline: Number(raw.revealDeadline),
        disputeDeadline: Number(raw.disputeDeadline),
        finalized: raw.finalized,
      };

      const members = await pub.readContract({
        address: MODULE,
        abi: MODULE_ABI,
        functionName: "committeeOf",
        args: [m.address],
      });
      const mine: {agentId: bigint; operator: `0x${string}`; pk: `0x${string}`; state: SeatState}[] = [];
      for (const agentId of members) {
        const operator = await pub.readContract({
          address: REGISTRY,
          abi: REGISTRY_ABI,
          functionName: "operatorOf",
          args: [agentId],
        });
        const pk = candidates.get(operator.toLowerCase());
        // A seat this operator cannot sign for belongs to somebody else's machine.
        // Not an error: a real committee is independent parties, and this pass
        // votes only its own seats.
        if (!pk) continue;
        const [commitment, reveal] = await Promise.all([
          pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "commitmentOf", args: [m.address, agentId]}),
          pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "revealOf", args: [m.address, agentId]}),
        ]);
        mine.push({
          agentId,
          operator,
          pk,
          state: {
            agentId: Number(agentId),
            committed: commitment !== NO_COMMITMENT,
            revealed: reveal !== NONE,
          },
        });
      }

      const due = phaseFor({now, resolvesBy, round, seats: mine.map((s) => s.state)});
      const seatsOf = (ids: number[]) => mine.filter((s) => ids.includes(s.state.agentId));

      // A commit whose reveal window has shut is a slashing that already happened.
      // Said out loud because the alternative is finding it in the tally afterwards.
      const stranded = mine.filter((s) => s.state.committed && !s.state.revealed && now > round.revealDeadline);
      if (stranded.length > 0) {
        console.log(`ALERT         ${short}  ${stranded.length} seat(s) committed and never revealed — they will be slashed`);
      }

      console.log(`${due.phase.padEnd(13)} ${short}  ${m.status}, round ${round.index}: ${due.why}`);
      if (due.nextDue !== null) dueAt.push(due.nextDue);

      if (due.phase === "commit") {
        if (DRY) {
          // Evidence is a read; inference and the receipt upload both SPEND, so a
          // dry run stops at the boundary where money starts.
          const observations = await gatherEvidence((await readSources(store, m.specRoot)) ?? [], {
            timeoutMs: Number(process.env.EVIDENCE_TIMEOUT_MS ?? 10_000),
            maxBytes: Number(process.env.EVIDENCE_MAX_BYTES ?? 256 * 1024),
          });
          for (const o of observations) console.log(`              ${describe(o)}`);
          console.log(`              would judge and commit for agent(s) ${due.seats.join(", ")} — nothing sent`);
          continue;
        }
        const spec = (await store.get(m.specRoot)) as {
          question?: string;
          rules?: string;
          category?: string;
          settlementPrompt?: string;
          sources?: {kind?: string; url: string; selector?: string}[];
        } | null;
        if (!spec?.question || !spec.rules) {
          console.log(`              no readable MarketSpec at ${m.specRoot} — cannot judge, not committing`);
          continue;
        }

        // ONE READ OF THE EVIDENCE for the whole committee, exactly as `resolve.ts`
        // does and for the reason it gives: three fetches of the same candle seconds
        // apart are three legitimately different closes and a split vote nothing was
        // wrong with.
        const observations = await gatherEvidence(spec.sources, {
          timeoutMs: Number(process.env.EVIDENCE_TIMEOUT_MS ?? 10_000),
          maxBytes: Number(process.env.EVIDENCE_MAX_BYTES ?? 256 * 1024),
        });
        for (const o of observations) console.log(`              ${describe(o)}`);
        if (process.env.EVIDENCE_DUMP === "1") for (const o of observations) console.log(`\n${renderObservation(o)}`);

        // How long the last seat took, end to end. The budget for the next one is
        // derived from it rather than assumed: nothing here knows how long an
        // enclave will take, but the previous call is a measurement of exactly that,
        // and starting a seat the window cannot hold spends real money on a
        // commitment that reverts `WindowClosed`.
        let lastSeatSeconds = 0;
        for (const seat of seatsOf(due.seats)) {
          const block = await pub.getBlock();
          const remaining = round.commitDeadline - Number(block.timestamp);
          if (remaining <= 0 || remaining < lastSeatSeconds) {
            console.log(
              `              stopping: ${remaining}s of commit window left and the last seat took ${lastSeatSeconds}s`,
            );
            break;
          }
          const startedAt = Date.now();
          const provider = providers[committed % providers.length]!;
          const inference = await inferenceFor(provider);
          const j: Judgement = await inference.settle({
            question: spec.question,
            rules: spec.rules,
            category: spec.category ?? null,
            settlementPrompt: spec.settlementPrompt ?? null,
            observations,
          });
          // §7.4: an unattested answer is not evidence, so do not commit it. An
          // ARITHMETIC judgement is unmodelled rather than unattested — no enclave
          // was asked because no model was — and what stands behind it is the
          // observation's own digest.
          const attested = j.route === "arithmetic" || j.attestation?.teeVerified === true;
          const outcome = attested ? j.outcome : UNRESOLVABLE;
          console.log(
            `              agent ${seat.agentId}: ${OUTCOME_NAMES[outcome]}` +
              (j.route === "arithmetic" ? " (decided in code)" : attested ? " (TEE verified)" : " (NOT VERIFIED → abstaining)"),
          );

          const receiptRoot = storeReceipt({
            version: 1,
            market: m.address,
            specRoot: m.specRoot,
            // The LIVE round index. A dispute round's receipts filed as round 1
            // would misattribute every vote in them.
            round: round.index,
            resolver: {agentId: Number(seat.agentId), address: seat.operator},
            inference:
              j.route === "arithmetic"
                ? {route: "arithmetic", providerAddress: null, model: null, chatID: null, teeVerified: false, temperature: null, simulated: false}
                : {
                    route: "broker",
                    providerAddress: provider,
                    model: j.attestation?.model ?? null,
                    chatID: j.attestation?.chatId ?? null,
                    teeVerified: j.attestation?.teeVerified ?? false,
                    temperature: 0,
                    simulated: false,
                  },
            evidence: receiptEvidence(observations),
            outcome: OUTCOME_NAMES[outcome],
            confidence: j.confidence,
            rationale: j.rationale,
            citations: observedIndices(observations),
            rawResponse: j.raw,
          });

          const salt = saltFor(seat.agentId, m.address);
          const commitment = commitmentFor(m.address, outcome, salt, receiptRoot, seat.operator);

          // Re-checked against the chain immediately before sending, and against
          // two different races: a second pass may have committed this seat, and
          // the window may have shut while the enclave was thinking. The inference
          // is already paid for either way; sending is what would add a reverted
          // transaction to the bill.
          const [live, head] = await Promise.all([
            pub.readContract({
              address: MODULE,
              abi: MODULE_ABI,
              functionName: "commitmentOf",
              args: [m.address, seat.agentId],
            }),
            pub.getBlock(),
          ]);
          if (Number(head.timestamp) > round.commitDeadline) {
            console.log(`              the commit window shut while agent ${seat.agentId} was being judged — not committing`);
            break;
          }
          if (live !== NO_COMMITMENT) {
            console.log(`              agent ${seat.agentId} was committed by another pass — skipping`);
            continue;
          }

          // WRITE-AHEAD. See `appendJournal`: the record must exist before the
          // transaction does, or a kill between them strands an unrevealable commit.
          appendJournal(JOURNAL, journalKey(CHAIN_ID, m.address, round.index, Number(seat.agentId)), {
            chainId: CHAIN_ID,
            market: m.address,
            round: round.index,
            agentId: Number(seat.agentId),
            operator: seat.operator,
            outcome,
            salt,
            receiptRoot,
            commitment,
            committedAt: Math.floor(Date.now() / 1000),
          });
          await send(seat.pk, "commitVote", [m.address, seat.agentId, commitment]);
          console.log(`              agent ${seat.agentId} committed, receipt ${receiptRoot}`);
          committed++;
          lastSeatSeconds = Math.ceil((Date.now() - startedAt) / 1000);
        }
        continue;
      }

      if (due.phase === "reveal") {
        const journal = readJournal(JOURNAL);
        for (const seat of seatsOf(due.seats)) {
          const record = journal[journalKey(CHAIN_ID, m.address, round.index, Number(seat.agentId))];
          if (!record) {
            // The commitment's pre-image is gone. Nothing can reveal it — not this
            // pass, not a person — so say which seat and stop pretending otherwise.
            console.log(`              agent ${seat.agentId} has a commit with no journal entry — it cannot be revealed`);
            continue;
          }
          // Three preconditions, all re-read from the chain rather than carried
          // over from the phase decision: the clock, because an earlier market in
          // this same pass may have spent the window; the commitment, because a
          // journal entry that does not hash to what is on chain reveals as
          // `BadCommitment` and slashes the seat it was meant to save; and the
          // reveal itself, because another pass may have got there first.
          const [live, already, head] = await Promise.all([
            pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "commitmentOf", args: [m.address, seat.agentId]}),
            pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "revealOf", args: [m.address, seat.agentId]}),
            pub.getBlock(),
          ]);
          const at = Number(head.timestamp);
          if (at <= round.commitDeadline || at > round.revealDeadline) {
            console.log(`              agent ${seat.agentId}: the reveal window is not open at ${at} — not revealing`);
            break;
          }
          if (live !== record.commitment) {
            console.log(`              agent ${seat.agentId}: on-chain commitment does not match the journal — not revealing`);
            continue;
          }
          if (already !== NONE) {
            console.log(`              agent ${seat.agentId} was revealed by another pass — skipping`);
            continue;
          }
          if (DRY) {
            console.log(`              would reveal ${OUTCOME_NAMES[record.outcome]} for agent ${seat.agentId} — nothing sent`);
            continue;
          }
          await send(seat.pk, "revealVote", [m.address, seat.agentId, record.outcome, record.salt, record.receiptRoot]);
          console.log(`              agent ${seat.agentId} revealed ${OUTCOME_NAMES[record.outcome]}`);
          revealed++;
        }
        continue;
      }

      if (due.phase === "finalize") {
        // Simulated first, for the reason `keeper.ts` gives about `close()`:
        // `finalize` is permissionless, so another pass or a bystander may have
        // done it since this pass read the round, and a throw here would abandon
        // every market later in the loop.
        try {
          await pub.simulateContract({
            address: MODULE,
            abi: MODULE_ABI,
            functionName: "finalize",
            args: [m.address],
            account: account.address,
          });
        } catch (err) {
          console.log(`              finalize() would revert (${reasonOf(err)}) — skipping`);
          continue;
        }
        if (DRY) {
          console.log(`              would finalize — nothing sent`);
          continue;
        }
        await send(KEY, "finalize", [m.address]);
        console.log(`              finalized`);
        finalized++;
        continue;
      }
    } catch (err) {
      console.error(`error         ${short}  ${reasonOf(err)}`);
      // Short, because the failure is usually the network rather than the clock,
      // and a market left mid-round is the one thing worth retrying soon.
      dueAt.push(now + DRAW_RECHECK_SECONDS);
    }
  }

  console.log("");
  console.log(
    `${committed} committed, ${revealed} revealed, ${finalized} finalized${DRY ? " (dry run — nothing sent)" : ""}`,
  );

  // ── when to come back ────────────────────────────────────────────────────
  // One line, parsed by scripts/committee-tick.sh. Printed last and always,
  // including when the answer is "never": a scheduler that cannot tell "nothing
  // is due" from "the pass crashed" will either poll forever or stop watching a
  // market with stake on it.
  const next = dueAt.length > 0 ? Math.min(...dueAt) : null;
  console.log("");
  if (next === null) {
    console.log("next-due none");
    console.log("Nothing is pending for this committee.");
  } else {
    const mins = Math.round((next - now) / 60);
    console.log(`next-due ${next}`);
    console.log(`Next action is due ${mins > 0 ? `in ${mins} min` : "now"}, at ${new Date(next * 1000).toISOString()}.`);
  }
}

/** One line per observation, the shape `resolve.ts` prints. */
function describe(o: Observation): string {
  return o.ok
    ? `[${o.index}] ${o.via === "selector" ? "selected" : "read"} ${o.value.length} chars from ${o.url} — sha256 ${o.fetch.sha256.slice(0, 16)}…`
    : `[${o.index}] NOT OBSERVED ${o.url} — ${o.reason}: ${o.detail}`;
}

/** The spec's sources alone, for the dry run, which has no use for the rest. */
async function readSources(store: ZgStore, specRoot: `0x${string}`) {
  const spec = (await store.get(specRoot)) as {sources?: {kind?: string; url: string; selector?: string}[]} | null;
  return spec?.sources ?? null;
}

/**
 * Run only when this file IS the program.
 *
 * `test/committee-tick.test.ts` imports `phaseFor` alone, and a unit test that
 * quietly opened a wallet and began committing votes from a live committee's keys
 * would be a good deal worse than no test. `realpathSync` on both sides, as in
 * `keeper.ts`: the tick script invokes this through a path that may be a symlink,
 * and a comparison that failed there would leave the committee doing nothing at
 * all — silently, which is the failure this whole file exists to end.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
}

if (invokedDirectly()) await main();
