/**
 * Gathering the evidence a resolver is supposed to judge on (spec §7.4 step 2).
 *
 * Until this module existed, `examples/resolve.ts` handed the model a list of
 * URLs. A language model cannot dereference a URL, so on any question about the
 * world it correctly answered UNRESOLVABLE — a three-member committee on Galileo
 * did exactly that, independently. Every market with a real question would have
 * FAILED rather than settled.
 *
 * What this module returns is therefore an OBSERVATION and not a link: the value
 * actually read out of the source, together with everything a stranger needs to
 * repeat the read — the URL that was finally fetched, the HTTP status, the byte
 * count, the sha256 of exactly those bytes, and the instant it happened. Those
 * fields go into the settlement receipt (§7.5), which anyone can pull off 0G
 * Storage and check.
 *
 * THE LINE THIS MODULE HOLDS. A source that could not be read produces an
 * explicit `ok: false` with a reason, never a blank, a zero, or a nearby value.
 * That is the same refusal `UnreadableBeliefError` makes for a model's reply: a
 * resolver that fills a gap with something plausible is worse than one that
 * abstains, because it looks exactly like one that knew.
 *
 * FETCHED BYTES ARE DATA, NEVER INSTRUCTIONS. A source URL returns bytes chosen
 * by whoever runs that server, and a market's sources are named by whoever
 * created the market. `renderObservation` therefore wraps content in a fence
 * whose token is derived from the content's own hash — a source cannot close its
 * own block without first predicting its own digest — and the settlement prompt
 * says in as many words that the fenced text has no authority over the rules.
 */
import {createHash} from "node:crypto";

/** A source exactly as a MarketSpec declares it (spec §5.2). */
export interface SpecSource {
  /** `http` is the only kind this module can read. Anything else is reported, not guessed. */
  kind?: string | null;
  url: string;
  /**
   * Either a path this module can execute (see `parsePath`) or a phrase in
   * English. The specs in `scripts/market-spec.py` contain both, and the two are
   * handled differently on purpose — see `classifySelector`.
   */
  selector?: string | null;
}

/** Why a source produced no observation. One of these, never a silent blank. */
export type ObservationFailure =
  /** `kind` is something other than http/https — `chain`, say. */
  | "unsupported-kind"
  /** Not a URL, or not an http(s) one. */
  | "unsupported-url"
  /** An http(s) URL aimed at the resolver's own network. */
  | "blocked-host"
  /** A path-shaped selector using syntax this module deliberately does not implement. */
  | "unsupported-selector"
  | "timeout"
  | "network"
  | "http-status"
  | "empty-body"
  /** More bytes than the cap allows, where a partial body cannot be used. */
  | "too-large"
  /** A path selector was declared and the body is not JSON. */
  | "malformed-body"
  /** The path is executable and the document simply does not contain it. */
  | "no-match";

/** What was asked for. Present on every observation, successful or not. */
export interface SourceRef {
  /** Position in `spec.sources[]`, so a receipt's `citations[]` line up with it. */
  index: number;
  url: string;
  kind: string;
  selector: string | null;
}

/** What the network actually returned. */
export interface Fetched {
  /** After redirects. Differs from `url` more often than one expects. */
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  /** Bytes RETAINED, which equals the response length unless `truncated`. */
  bytes: number;
  /** sha256 of exactly those retained bytes, lower-case hex, no `0x`. */
  sha256: string;
  /** The response was longer than the cap and the rest was never read. */
  truncated: boolean;
}

export interface ObservedValue extends SourceRef {
  ok: true;
  /** Unix seconds. */
  fetchedAt: number;
  fetch: Fetched;
  /** `selector` — the declared path was executed. `document` — the body itself. */
  via: "selector" | "document";
  /** A selector that is a phrase rather than a path, carried through unexecuted. */
  hint: string | null;
  /** The observation. Text, always; never coerced to a number by this module. */
  value: string;
  /** `value` was cut at the character bound. */
  clipped: boolean;
}

export interface UnobservedSource extends SourceRef {
  ok: false;
  /** Unix seconds. When the attempt was made, not when it would have succeeded. */
  attemptedAt: number;
  reason: ObservationFailure;
  /**
   * One line a human can act on. Deliberately built from this module's own
   * vocabulary and the response METADATA — never from the response body, which
   * would smuggle third-party text outside the fence `renderObservation` puts it in.
   */
  detail: string;
  fetch: Fetched | null;
}

export type Observation = ObservedValue | UnobservedSource;

export interface GatherOptions {
  /** Injected so a test never touches a live API. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per source, covering the body read as well as the headers. */
  timeoutMs?: number;
  /** Hard cap on bytes retained per source. */
  maxBytes?: number;
  /** Hard cap on the characters of a single observation, prompt and receipt alike. */
  maxValueChars?: number;
  userAgent?: string;
  /** Unix MILLIseconds. Injected so a receipt is reproducible under test. */
  now?: () => number;
  /**
   * Off by default. A MarketSpec is written by a stranger and its URLs are
   * dereferenced inside the resolver's own network, so `http://169.254.169.254/`
   * is a request the market creator gets to make on the operator's behalf.
   */
  allowPrivateHosts?: boolean;
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 256 * 1024,
  maxValueChars: 4_000,
  userAgent: "brier-resolver/0.1 (+https://github.com/brier)",
} as const;

// ── selectors ──────────────────────────────────────────────────────────────

/** A member name or an array index. There is nothing else in the subset. */
export type PathStep = {readonly member: string} | {readonly index: number};

export class SelectorSyntaxError extends Error {
  constructor(
    readonly selector: string,
    readonly why: string,
  ) {
    super(`selector ${JSON.stringify(selector)} is not one this resolver can execute: ${why}`);
    this.name = "SelectorSyntaxError";
  }
}

/**
 * Three kinds, because the specs contain three kinds.
 *
 * `$[0][4]` is a path and gets executed. `"final standings"` and
 * `"euro area, annual rate, flash"` are English: they tell a READER which part
 * of the page matters, and no parser turns them into an index. Calling those a
 * failed match would report a defect that is not there, and calling them a
 * successful extraction would be a lie — so they are carried through as a hint
 * alongside the whole document, and the model is told they were not executed.
 *
 * The guess this makes: a selector starting `$`, `.` or `[` is an attempt at a
 * path even when it is malformed, because English never starts that way.
 */
export function classifySelector(selector: string | null | undefined): "none" | "path" | "hint" {
  const s = (selector ?? "").trim();
  if (s === "") return "none";
  return s.startsWith("$") || s.startsWith(".") || s.startsWith("[") ? "path" : "hint";
}

/**
 * The JSONPath-ish subset the specs actually declare, and no more.
 *
 * SUPPORTED: `$`, `.name`, `["name"]`, `['name']`, `[0]`, `[-1]`, chained in any
 * order. A negative index counts from the end, which is what "the latest candle"
 * wants.
 *
 * NOT SUPPORTED, and rejected by name rather than ignored: wildcards, recursive
 * descent, slices, unions, filter expressions. Silently skipping an operator
 * would select a different value than the market committed to, which is the one
 * outcome worse than selecting nothing.
 */
export function parsePath(selector: string): PathStep[] {
  const s = selector.trim();
  let i = s.startsWith("$") ? 1 : 0;
  const steps: PathStep[] = [];
  while (i < s.length) {
    const c = s[i];
    if (c === ".") {
      if (s[i + 1] === ".") throw new SelectorSyntaxError(selector, "recursive descent (`..`) is not supported");
      if (s[i + 1] === "*") throw new SelectorSyntaxError(selector, "wildcards (`.*`) are not supported");
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_$-]/.test(s[j] ?? "")) j++;
      const name = s.slice(i + 1, j);
      if (name === "") throw new SelectorSyntaxError(selector, `expected a member name after "." at position ${i}`);
      steps.push({member: name});
      i = j;
      continue;
    }
    if (c === "[") {
      const close = s.indexOf("]", i);
      if (close === -1) throw new SelectorSyntaxError(selector, `unclosed "[" at position ${i}`);
      const inner = s.slice(i + 1, close).trim();
      if (inner === "*") throw new SelectorSyntaxError(selector, "wildcards (`[*]`) are not supported");
      if (inner.startsWith("?")) throw new SelectorSyntaxError(selector, "filter expressions (`[?(…)]`) are not supported");
      if (inner.includes(":")) throw new SelectorSyntaxError(selector, "slices (`[a:b]`) are not supported");
      if (inner.includes(",")) throw new SelectorSyntaxError(selector, "unions (`[a,b]`) are not supported");
      if (/^-?\d+$/.test(inner)) {
        steps.push({index: Number(inner)});
      } else if (inner.length >= 2 && ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'")))) {
        steps.push({member: inner.slice(1, -1)});
      } else {
        throw new SelectorSyntaxError(selector, `"[${inner}]" is neither an integer index nor a quoted member name`);
      }
      i = close + 1;
      continue;
    }
    throw new SelectorSyntaxError(selector, `unexpected ${JSON.stringify(c)} at position ${i}`);
  }
  return steps;
}

export type PathResult = {readonly found: true; readonly value: unknown} | {readonly found: false; readonly detail: string};

/** English for what a JSON value is, so a miss can say where it went wrong. */
function shapeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  switch (typeof v) {
    case "object":
      return "an object";
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    default:
      return "absent";
  }
}

/** Walk the steps, reporting exactly where the document stopped matching. */
export function applyPath(root: unknown, steps: readonly PathStep[]): PathResult {
  let cur: unknown = root;
  let where = "$";
  for (const step of steps) {
    if ("index" in step) {
      if (!Array.isArray(cur)) {
        return {found: false, detail: `${where} is ${shapeOf(cur)}, not an array, so [${step.index}] selects nothing`};
      }
      // A negative index counts from the end: `$[-1][4]` is "the latest candle".
      const at = step.index < 0 ? cur.length + step.index : step.index;
      where += `[${step.index}]`;
      if (at < 0 || at >= cur.length) {
        return {found: false, detail: `${where} is out of range: the array holds ${cur.length} element(s)`};
      }
      cur = cur[at];
    } else {
      if (typeof cur !== "object" || cur === null || Array.isArray(cur)) {
        return {found: false, detail: `${where} is ${shapeOf(cur)}, not an object, so .${step.member} selects nothing`};
      }
      where += `.${step.member}`;
      const o = cur as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(o, step.member)) {
        return {found: false, detail: `${where} is absent from the document`};
      }
      cur = o[step.member];
    }
  }
  return {found: true, value: cur};
}

// ── reading a body ─────────────────────────────────────────────────────────

/**
 * Markup to text, well enough for a model to read a page it has no selector for.
 *
 * Not an HTML parser and not trying to be: it drops scripts, styles and comments,
 * turns block ends into newlines so a table does not collapse into one line, then
 * strips what is left. Entities are decoded AFTER tags are stripped, so a decoded
 * `&lt;script&gt;` becomes visible text rather than a tag that survived the strip.
 */
export function textFromHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    // A truncated body can end mid-script; without this the source code survives.
    .replace(/<(script|style)\b[\s\S]*$/i, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|section|article|table|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#0*39);/gi, "'")
    .replace(/&#(\d{1,7});/g, (_m, d: string) => codePoint(Number(d)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, h: string) => codePoint(parseInt(h, 16)))
    // Last, so an `&amp;#39;` cannot be double-decoded into an apostrophe.
    .replace(/&amp;/gi, "&")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Clip to a character bound, saying whether anything was lost. */
function clip(text: string, max: number): {value: string; clipped: boolean} {
  return text.length <= max ? {value: text, clipped: false} : {value: text.slice(0, max), clipped: true};
}

/**
 * Read at most `maxBytes`, then hang up.
 *
 * One chunk of overshoot is tolerated deliberately: reading until the total
 * EXCEEDS the cap is the only way to distinguish "the response was exactly this
 * long" from "the response was cut here", and a receipt that could not tell those
 * apart would be reporting a partial document as a whole one.
 */
async function readBounded(res: Response, maxBytes: number): Promise<{bytes: Buffer; truncated: boolean}> {
  const body = res.body;
  if (!body) {
    const all = Buffer.from(new Uint8Array(await res.arrayBuffer()));
    return {bytes: all.subarray(0, maxBytes), truncated: all.byteLength > maxBytes};
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return {bytes: Buffer.concat(chunks).subarray(0, maxBytes), truncated};
}

/**
 * Hostnames that address the machine the resolver runs on, or its neighbours.
 *
 * A partial defence and labelled as one: it stops a literal `127.0.0.1` or
 * `169.254.169.254` in a MarketSpec, and does NOT stop a public name whose DNS
 * answer is private. Closing that needs a resolve-then-pin transport, which is a
 * larger change than this module.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

// ── the observation ────────────────────────────────────────────────────────

/**
 * Read one source.
 *
 * Never rejects: every way this can go wrong is a reason on an `UnobservedSource`,
 * because a resolver that threw here would abandon the other sources and the vote
 * with them.
 */
export async function observeSource(source: SpecSource, index: number, options: GatherOptions = {}): Promise<Observation> {
  const now = options.now ?? Date.now;
  const at = Math.floor(now() / 1000);
  const declaredKind = (source.kind ?? "http").trim() || "http";
  const ref: SourceRef = {index, url: source.url, kind: declaredKind, selector: source.selector ?? null};
  const fail = (reason: ObservationFailure, detail: string, fetched: Fetched | null = null): UnobservedSource => ({
    ...ref,
    ok: false,
    attemptedAt: at,
    reason,
    detail,
    fetch: fetched,
  });

  try {
    const kind = declaredKind.toLowerCase();
    if (kind !== "http" && kind !== "https") {
      return fail(
        "unsupported-kind",
        `this resolver reads http(s) sources only, and the market declared kind "${declaredKind}"`,
      );
    }

    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      return fail("unsupported-url", `${JSON.stringify(source.url)} is not a URL`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fail("unsupported-url", `scheme "${url.protocol.replace(":", "")}" is not one this resolver dereferences`);
    }
    if (!options.allowPrivateHosts && isPrivateHost(url.hostname)) {
      return fail("blocked-host", `"${url.hostname}" addresses a private or loopback network, which a market may not aim a resolver at`);
    }

    // Parsed BEFORE the request: a selector this module cannot execute makes the
    // fetch pointless, and saying so costs the source nothing.
    const shape = classifySelector(source.selector);
    let steps: PathStep[] = [];
    if (shape === "path") {
      try {
        steps = parsePath(source.selector ?? "");
      } catch (e) {
        return fail("unsupported-selector", e instanceof SelectorSyntaxError ? e.why : String(e));
      }
    }

    const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
    const maxValueChars = options.maxValueChars ?? DEFAULTS.maxValueChars;
    const doFetch = options.fetchImpl ?? globalThis.fetch;

    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method: "GET",
        redirect: "follow",
        // No cookies and no credentials: whatever this resolver's process happens
        // to be authenticated for is not a market creator's to spend.
        credentials: "omit",
        headers: {
          accept: "application/json;q=0.9, text/html;q=0.8, */*;q=0.5",
          "user-agent": options.userAgent ?? DEFAULTS.userAgent,
        },
        // Covers the body read too — an abort errors the stream — so a source
        // that answers its headers and then dribbles cannot hold the vote open.
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULTS.timeoutMs),
      });
    } catch (e) {
      const name = (e as {name?: string}).name;
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      return name === "TimeoutError" || name === "AbortError"
        ? fail("timeout", `no complete response within ${options.timeoutMs ?? DEFAULTS.timeoutMs} ms`)
        : fail("network", `the request did not complete: ${why}`);
    }

    let bytes: Buffer;
    let truncated: boolean;
    try {
      ({bytes, truncated} = await readBounded(res, maxBytes));
    } catch (e) {
      const name = (e as {name?: string}).name;
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      return name === "TimeoutError" || name === "AbortError"
        ? fail("timeout", `the body stopped arriving within ${options.timeoutMs ?? DEFAULTS.timeoutMs} ms`)
        : fail("network", `the body could not be read: ${why}`);
    }

    const fetched: Fetched = {
      finalUrl: res.url || url.toString(),
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      truncated,
    };

    // A 404 page and a 500 page both have a body, and reading one as evidence is
    // how a resolver ends up quoting an error page as a price.
    if (!res.ok) return fail("http-status", `the source answered HTTP ${res.status}`, fetched);
    if (bytes.byteLength === 0) return fail("empty-body", "the source answered with no body at all", fetched);

    const text = new TextDecoder("utf-8").decode(bytes);

    if (shape === "path") {
      // A truncated JSON body is not JSON, and parsing a prefix would be reading
      // a document that was never sent.
      if (truncated) {
        return fail(
          "too-large",
          `a selector needs the whole document and the body exceeds this resolver's ${maxBytes}-byte cap`,
          fetched,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return fail(
          "malformed-body",
          `the selector needs JSON and the body did not parse as JSON (content-type ${fetched.contentType ?? "unset"})`,
          fetched,
        );
      }
      const hit = applyPath(json, steps);
      if (!hit.found) return fail("no-match", `the selector matched nothing: ${hit.detail}`, fetched);
      // JSON null is how a great many APIs spell "no data for that key". Reading
      // it as the observed value would put the string "null" in front of a model
      // that has no way to tell it from a reading.
      if (hit.value === null || hit.value === undefined) {
        return fail("no-match", "the selector resolved to JSON null, which is an absence rather than a reading", fetched);
      }
      const rendered = clip(typeof hit.value === "string" ? hit.value : JSON.stringify(hit.value) ?? "", maxValueChars);
      return {...ref, ok: true, fetchedAt: at, fetch: fetched, via: "selector", hint: null, ...rendered};
    }

    // No executable selector: the whole document, made readable. JSON is
    // re-serialised rather than HTML-stripped, because stripping tags out of JSON
    // would mangle it.
    let readable: string;
    try {
      readable = JSON.stringify(JSON.parse(text), null, 1);
    } catch {
      readable = /html/i.test(fetched.contentType ?? "") || /<\s*[a-z!/]/i.test(text.slice(0, 512))
        ? textFromHtml(text)
        : text;
    }
    if (readable.trim() === "") {
      return fail("empty-body", "the body held no readable text once markup was removed", fetched);
    }
    const rendered = clip(readable, maxValueChars);
    return {
      ...ref,
      ok: true,
      fetchedAt: at,
      fetch: fetched,
      via: "document",
      hint: shape === "hint" ? (source.selector ?? "").trim() : null,
      ...rendered,
    };
  } catch (e) {
    // Belt and braces. An unexpected throw here would take the whole committee
    // down with it, and one unreadable source is not a reason to stop voting.
    return fail("network", `this resolver failed while reading the source: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
}

/**
 * Read every source a spec declares.
 *
 * In parallel and once, not once per committee member: three members fetching a
 * live candle seconds apart would legitimately read three different closes and
 * split a vote that nothing was wrong with. Whether independent operators SHOULD
 * share a read is a question about committee design, not about this function —
 * see the note in `examples/resolve.ts`.
 */
export async function gatherEvidence(
  sources: readonly SpecSource[] | null | undefined,
  options: GatherOptions = {},
): Promise<Observation[]> {
  return Promise.all((sources ?? []).map((s, i) => observeSource(s, i, options)));
}

// ── presenting it ──────────────────────────────────────────────────────────

/**
 * A fence token no source can forge.
 *
 * It is the first twelve hex of the sha256 of the very bytes inside the fence, so
 * closing the block early would require a body that contains its own digest. The
 * receipt records the same sha256, which means a reader can rebuild the exact
 * prompt the resolver sent.
 */
function fenceToken(o: ObservedValue): string {
  return o.fetch.sha256.slice(0, 12);
}

/** One block per source, for the prompt. Untrusted content only ever appears inside a fence. */
export function renderObservation(o: Observation): string {
  const head = `[${o.index}] SOURCE ${o.url}  (kind ${o.kind}${o.selector === null ? "" : `, selector ${JSON.stringify(o.selector)}`})`;
  if (!o.ok) {
    const status = o.fetch ? ` HTTP ${o.fetch.httpStatus}.` : "";
    return [head, `    NOT OBSERVED — ${o.reason}: ${o.detail}.${status}`].join("\n");
  }

  const f = o.fetch;
  const provenance = [
    `    read at ${new Date(o.fetchedAt * 1000).toISOString()}, HTTP ${f.httpStatus} ${f.contentType ?? "(no content-type)"}, ${f.bytes} bytes, sha256 ${f.sha256}`,
  ];
  if (f.finalUrl !== o.url) provenance.push(`    after redirects: ${f.finalUrl}`);
  provenance.push(
    o.via === "selector"
      ? `    the value below is what the selector ${JSON.stringify(o.selector)} selected — not the whole document`
      : o.hint === null
        ? `    no selector was declared, so the value below is the whole document as text`
        : `    the market's selector ${JSON.stringify(o.hint)} is a description, not a path this resolver can execute; the whole document is below and you must find that part in it yourself`,
  );
  if (f.truncated) provenance.push(`    only the first ${f.bytes} bytes were read (this resolver's cap); the document continues past that`);
  if (o.clipped) provenance.push(`    the text below was cut at this resolver's character cap; it does not end where the document does`);

  const token = fenceToken(o);
  return [
    head,
    ...provenance,
    `--- BEGIN SOURCE ${o.index} DATA ${token} ---`,
    o.value,
    `--- END SOURCE ${o.index} DATA ${token} ---`,
  ].join("\n");
}

// ── the receipt ────────────────────────────────────────────────────────────

/**
 * An `evidence[]` entry as §7.5 shapes it, widened to carry the observation.
 *
 * `url` and `fetchedAt` keep the field names the published receipt already uses,
 * so the frontend's reader is untouched. What is new is everything after them:
 * without the value and its digest, a receipt records that a resolver looked
 * somewhere and not what it saw.
 */
export type ReceiptEvidence =
  | {
      url: string;
      kind: string;
      selector: string | null;
      observed: true;
      fetchedAt: number;
      finalUrl: string;
      httpStatus: number;
      contentType: string | null;
      bytes: number;
      sha256: string;
      truncated: boolean;
      via: "selector" | "document";
      hint: string | null;
      value: string;
      clipped: boolean;
    }
  | {
      url: string;
      kind: string;
      selector: string | null;
      observed: false;
      attemptedAt: number;
      reason: ObservationFailure;
      detail: string;
      httpStatus: number | null;
      sha256: string | null;
    };

export function receiptEvidence(observations: readonly Observation[]): ReceiptEvidence[] {
  return observations.map((o) =>
    o.ok
      ? {
          url: o.url,
          kind: o.kind,
          selector: o.selector,
          observed: true as const,
          fetchedAt: o.fetchedAt,
          finalUrl: o.fetch.finalUrl,
          httpStatus: o.fetch.httpStatus,
          contentType: o.fetch.contentType,
          bytes: o.fetch.bytes,
          sha256: o.fetch.sha256,
          truncated: o.fetch.truncated,
          via: o.via,
          hint: o.hint,
          value: o.value,
          clipped: o.clipped,
        }
      : {
          url: o.url,
          kind: o.kind,
          selector: o.selector,
          observed: false as const,
          attemptedAt: o.attemptedAt,
          reason: o.reason,
          detail: o.detail,
          httpStatus: o.fetch?.httpStatus ?? null,
          sha256: o.fetch?.sha256 ?? null,
        },
  );
}

/**
 * The sources a judgement could actually have rested on.
 *
 * The receipt's `citations[]` used to be every index in `sources[]`, which
 * claimed the resolver had read documents it had never fetched.
 */
export function observedIndices(observations: readonly Observation[]): number[] {
  return observations.filter((o) => o.ok).map((o) => o.index);
}
