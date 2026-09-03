/**
 * Reading `src/` as text, for the rules that live at a call site and cannot be typed.
 *
 * Two of this project's three arithmetic rules are of that kind: nothing in the
 * type system stops `market.marginalPriceWad[1]` from being compared against a
 * belief, and nothing stops a payout from being written `WAD * WAD / P`. Both
 * compile, both run, and both are wrong by a few points in the direction that
 * costs money. `packages/agent-kit/test/network-boundary.test.ts` established
 * the shape used here — scan the source, and assert first that the scan found
 * the files it meant to scan, because a scanner that finds nothing passes every
 * assertion after it for free.
 *
 * WHOLE-LINE COMMENTS ARE BLANKED BEFORE ANY SCAN, and that is load-bearing
 * rather than tidy: this project's comments explain the mistakes by naming
 * them, so `agent.ts` says "never against `marginalPriceWad`" in its own header.
 * A scanner that read prose would fail on the file's own explanation of why it
 * is correct.
 */
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

export interface SourceFile {
  name: string;
  /** As written, comments and all. */
  text: string;
  /** The same file with whole-line comments blanked, line numbering preserved. */
  code: string;
}

/**
 * Resolved against this file rather than `process.cwd()`, so the scan reads the
 * `src/` that sits beside the `test/` it is running from — including a copy of
 * this project taken somewhere else, which is how these rules get mutation
 * tested without ever editing the repository's own sources.
 */
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

export function loadSrc(): SourceFile[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => {
      const text = readFileSync(join(SRC_DIR, name), "utf8");
      return {name, text, code: blankComments(text)};
    });
}

export function fileNamed(files: readonly SourceFile[], name: string): SourceFile {
  const found = files.find((f) => f.name === name);
  if (found === undefined) {
    throw new Error(`src/${name} is gone — this test scans it by name and has just scanned nothing`);
  }
  return found;
}

/**
 * Comment LINES only.
 *
 * A trailing `// …` on a line of code survives, which is deliberate: it keeps
 * this from needing a tokenizer, and a note parked at the end of a live
 * statement is close enough to that statement that a scanner flagging it is
 * telling the truth about where the reader's eye goes.
 */
export function blankComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      const isComment = trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
      return isComment ? "" : line;
    })
    .join("\n");
}

/**
 * The statement an occurrence sits in, bounded by the semicolons around it.
 *
 * Semicolons ONLY, and braces deliberately not: `${…}` puts a closing brace in
 * the middle of every interpolated string, so a window that stopped at one
 * would cut a multi-line `console.log` off from its own `console.log(` — which
 * is precisely the statement these scans need to recognise. Crude otherwise,
 * and enough: the only distinction drawn below is "this is being printed"
 * against "this is being compared".
 */
export function statementAround(code: string, index: number): string {
  const start = code.lastIndexOf(";", index) + 1;
  const end = code.indexOf(";", index);
  return code.slice(start, end === -1 ? code.length : end + 1).trim();
}

/** 1-based, for a failure message that names a line somebody can open. */
export function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/** Every match of `pattern` in `code`, with the line and the statement around it. */
export function occurrences(
  code: string,
  pattern: RegExp,
): {match: string; index: number; line: number; statement: string; groups: readonly (string | undefined)[]}[] {
  const found: {
    match: string;
    index: number;
    line: number;
    statement: string;
    groups: readonly (string | undefined)[];
  }[] = [];
  for (const hit of code.matchAll(pattern)) {
    const index = hit.index ?? 0;
    found.push({
      match: hit[0],
      index,
      line: lineOf(code, index),
      statement: statementAround(code, index),
      groups: hit.slice(1),
    });
  }
  return found;
}
