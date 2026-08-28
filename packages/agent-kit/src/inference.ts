import {ethers} from "ethers";
import {createZGComputeNetworkBroker} from "@0gfoundation/0g-compute-ts-sdk";
import {WAD, networkFor, type ChainMode} from "@0g-delphi/protocol";

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
