import {ethers} from "ethers";
import {createZGComputeNetworkBroker} from "@0gfoundation/0g-compute-ts-sdk";
import {WAD, networkFor, isCategory, type Category, type ChainMode} from "@0g-delphi/protocol";

/**
 * What an agent knows about where an answer came from.
 *
 * `teeVerified` is the field the whole 0G Compute integration exists for, and it
 * is reported rather than acted on. What TeeML attests is narrow and worth
 * stating exactly: that THIS provider ran THIS model over THIS input inside an
 * enclave. It does not attest that the answer is correct, and re-running the
 * same prompt is corroboration rather than proof — even at temperature 0, an LLM
 * is not guaranteed bit-identical (spec §7.5).
 */
export interface Attestation {
  model: string;
  provider: `0x${string}`;
  chatId: string;
  teeVerified: boolean;
}

export interface Answer extends Attestation {
  content: string;
}

export interface Belief extends Attestation {
  /** P(YES) as the model sees it, wad. */
  impliedProbabilityWad: bigint;
  rationale: string;
  /** The model's reply verbatim, so a receipt can carry what was actually said. */
  raw: string;
}

/**
 * What a resolver is told to watch out for, per category (spec §7.4 step 3).
 *
 * Every one of these is a way a resolver has been fooled by a question that looked
 * settled and was not: a scheduled election read as a held one, a league leader read
 * as a champion, a revision read as the release it revised. The template does not
 * tell the model the answer — it tells it which near-miss to refuse.
 */
const CATEGORY_TEMPLATES: Record<Category, string> = {
  crypto:
    "Prices are per an exact venue and an exact instant. Do not substitute a nearby minute, " +
    "a different exchange, or an index for a spot pair. If the named source has no observation " +
    "covering the named instant, that is UNRESOLVABLE.",
  politics:
    "Distinguish what has HAPPENED from what is scheduled, announced, or expected. An " +
    "announcement, a dissolution, a called vote and a poll are none of them the event itself.",
  sports:
    "Distinguish a final result from a standing. A leader is not a champion, a leg is not a tie, " +
    "and a fixture that has not been played has no result — however certain it looks.",
  economics:
    "Statistical releases come in versions. Use the exact release the rules name — flash, " +
    "preliminary or final — and ignore every other, including later revisions of the same period.",
  science:
    "Distinguish an event from its plan. A scheduled launch, a rollout, a scrubbed attempt and a " +
    "successful one are four different things, and the rules will say which counts.",
  culture:
    "Distinguish a win from a nomination, and an award from its ceremony. Credits are often " +
    "shared or disputed — read exactly whose name the rules ask about.",
};

/** NO, YES, or "this question cannot be answered". */
export type SettlementOutcome = 0 | 1 | 2;

export interface Judgement extends Attestation {
  outcome: SettlementOutcome;
  confidence: number | null;
  rationale: string;
  raw: string;
}

/** Thrown when a reply cannot be read as a probability. Never defaulted. */
export class UnreadableBeliefError extends Error {
  constructor(readonly raw: string) {
    super(`the model's reply is not a probability this agent can act on: ${raw.slice(0, 200)}`);
    this.name = "UnreadableBeliefError";
  }
}

export interface InferenceConfig {
  network?: ChainMode;
  privateKey: `0x${string}`;
  /** A provider from `listServices()`. Never hardcode one in an agent: the
   *  catalogue shifts, and a dead address fails at request time. */
  provider: `0x${string}`;
  rpcUrl?: string;
}

/**
 * Inference on 0G Compute, with its attestation carried out alongside the answer.
 *
 * The broker moves real funds: a ledger, a per-provider sub-account, and a
 * settlement transaction per request. `listServices` is free and is the only
 * call here that is.
 */
export class ZgInference {
  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK exports no broker type
    private readonly broker: any,
    private readonly provider: `0x${string}`,
  ) {}

  static async connect(config: InferenceConfig): Promise<ZgInference> {
    const net = networkFor(config.network ?? "galileo");
    const rpc = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);
    const wallet = new ethers.Wallet(config.privateKey, rpc);
    return new ZgInference(await createZGComputeNetworkBroker(wallet), config.provider);
  }

  /** The live catalogue. Free, and the only way to learn a provider address. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK exports no service type
  static async listServices(config: Omit<InferenceConfig, "provider">): Promise<any[]> {
    const net = networkFor(config.network ?? "galileo");
    const rpc = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);
    const wallet = new ethers.Wallet(config.privateKey, rpc);
    const broker = await createZGComputeNetworkBroker(wallet);
    return broker.inference.listService();
  }

  async ask(prompt: string): Promise<Answer> {
    const meta = await this.broker.inference.getServiceMetadata(this.provider);
    // Single-use, and derived from the content — the same headers cannot be
    // replayed for a different prompt.
    const headers = await this.broker.inference.getRequestHeaders(this.provider, prompt);

    const res = await fetch(`${meta.endpoint}/chat/completions`, {
      method: "POST",
      headers: {...headers, "Content-Type": "application/json"},
      body: JSON.stringify({
        model: meta.model,
        messages: [{role: "user", content: prompt}],
        temperature: 0,
      }),
    });
    if (!res.ok) throw new Error(`0G Compute provider answered ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as {id?: string; choices?: {message?: {content?: string}}[]};
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("0G Compute returned no message content");
    const chatId = res.headers.get("ZG-Res-Key") ?? body.id;
    if (!chatId) throw new Error("0G Compute returned no chat id — the response cannot be attested");

    // `processResponse` both settles the request and returns the attestation.
    // `null` means it could not be established, which is NOT the same as true.
    const verified = await this.broker.inference.processResponse(this.provider, chatId);

    return {
      content,
      model: meta.model,
      provider: this.provider,
      chatId,
      teeVerified: verified === true,
    };
  }

  /**
   * Judge a market against its own promised rules (spec §7.4).
   *
   * A resolver answers one of three things, and the third is not a third answer to
   * the question: UNRESOLVABLE says the question cannot be answered, which routes
   * to `Market.fail()` and liquidates every side rather than paying one. A model
   * that is unsure must be able to say so, or it will guess.
   *
   * Unlike `believe`, this DOES show the model the settlement prompt the creator
   * committed to — that prompt is the instruction it is being held to, and judging
   * without it would be judging a different question than the one traders were sold.
   */
  async settle(spec: {
    question: string;
    rules: string;
    category?: string | null;
    settlementPrompt?: string | null;
    evidence?: readonly {url: string; note?: string}[];
  }): Promise<Judgement> {
    const evidence = (spec.evidence ?? []).map((e, i) => `[${i}] ${e.url}${e.note ? ` — ${e.note}` : ""}`);
    const prompt = [
      "You are a settlement resolver. Answer ONLY with a JSON object of the form",
      '{"outcome": "YES"|"NO"|"UNRESOLVABLE", "confidence": <0..1>, "rationale": "<one or two sentences>"}',
      "and nothing else — no markdown fence, no preamble.",
      "",
      `QUESTION: ${spec.question}`,
      "",
      `RESOLUTION RULES: ${spec.rules}`,
      // The category template comes BEFORE the creator's own prompt, so a creator can
      // narrow what the resolver must check but cannot quietly waive the near-miss the
      // category is there to catch.
      ...(spec.category && isCategory(spec.category)
        ? ["", `FOR ${spec.category.toUpperCase()} QUESTIONS: ${CATEGORY_TEMPLATES[spec.category]}`]
        : []),
      ...(spec.settlementPrompt ? ["", `SETTLEMENT INSTRUCTIONS: ${spec.settlementPrompt}`] : []),
      ...(evidence.length > 0 ? ["", "EVIDENCE:", ...evidence] : []),
      "",
      "Answer UNRESOLVABLE if the rules cannot be applied to the evidence available.",
      "That is not a failure — a resolver that guesses is worse than one that abstains.",
    ].join("\n");

    const answer = await this.ask(prompt);
    return {...answer, ...parseJudgement(answer.content), raw: answer.content};
  }

  /**
   * A probability for YES, from the market's own promised rules.
   *
   * The market's CURRENT probability is deliberately not shown to the model. An
   * agent's edge is the difference between its belief and the market's, and a
   * model told the market price anchors on it — the difference then measures the
   * anchor rather than the analysis.
   */
  async believe(spec: {question: string; rules: string; settlementPrompt?: string | null}): Promise<Belief> {
    const prompt = [
      "You are a forecasting analyst. Answer ONLY with a JSON object of the form",
      '{"probability": <number between 0 and 1>, "rationale": "<one or two sentences>"}',
      "and nothing else — no markdown fence, no preamble.",
      "",
      `QUESTION: ${spec.question}`,
      "",
      `RESOLUTION RULES: ${spec.rules}`,
      ...(spec.settlementPrompt ? ["", `SETTLEMENT INSTRUCTIONS: ${spec.settlementPrompt}`] : []),
      "",
      "`probability` is your probability that this resolves YES.",
    ].join("\n");

    const answer = await this.ask(prompt);
    const parsed = parseBelief(answer.content);
    return {...answer, ...parsed, raw: answer.content};
  }
}

/**
 * Strict on purpose.
 *
 * A lenient parser that fell back to 0.5 would let an agent trade on a reply it
 * did not understand while looking exactly like one that had a view — and 0.5 is
 * never neutral on a DPM book, because it is a position against whatever the
 * market currently says.
 */
export function parseBelief(raw: string): {impliedProbabilityWad: bigint; rationale: string} {
  // Models fence JSON even when told not to; that is a formatting habit rather
  // than a different answer, so the fence is stripped and nothing else is.
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UnreadableBeliefError(raw);
  }
  if (typeof json !== "object" || json === null) throw new UnreadableBeliefError(raw);
  const o = json as Record<string, unknown>;
  const p = o.probability;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) throw new UnreadableBeliefError(raw);
  return {
    impliedProbabilityWad: BigInt(Math.round(p * 1e6)) * (WAD / 1_000_000n),
    rationale: typeof o.rationale === "string" ? o.rationale : "",
  };
}

/**
 * Strict, for the same reason `parseBelief` is: a resolver that defaulted an
 * unreadable reply to any outcome would be settling a market on noise. The safe
 * default people reach for — UNRESOLVABLE — is not safe either: it liquidates every
 * position, which is a decision, not an abstention from one.
 */
export function parseJudgement(raw: string): {
  outcome: SettlementOutcome;
  confidence: number | null;
  rationale: string;
} {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UnreadableBeliefError(raw);
  }
  if (typeof json !== "object" || json === null) throw new UnreadableBeliefError(raw);
  const o = json as Record<string, unknown>;
  const outcome = o.outcome === "YES" ? 1 : o.outcome === "NO" ? 0 : o.outcome === "UNRESOLVABLE" ? 2 : null;
  if (outcome === null) throw new UnreadableBeliefError(raw);
  const c = o.confidence;
  return {
    outcome: outcome as SettlementOutcome,
    confidence: typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1 ? c : null,
    rationale: typeof o.rationale === "string" ? o.rationale : "",
  };
}
