import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

/**
 * The documentation's reference pages name real methods, real errors and real
 * addresses.
 *
 * This reads sources rather than rendering, because the failure it guards
 * against is a rename: `DelphiZeroClient` became `BrierClient` in a single sweep,
 * and a reference that had documented the old name would have gone on looking
 * authoritative while sending every reader to a method that no longer exists.
 * Documentation does not fail loudly on its own — nothing imports it.
 *
 * Deliberately textual. The frontend cannot import `@brier/agent-kit`: a test
 * enforces that it holds no write path to the chain, and taking the dependency
 * to check a doc string would be a strange way to lose that guarantee.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

/** Every documentation page, concatenated. One page moving no longer hides a claim. */
function docsSource(): string {
  const dir = join(ROOT, "frontend/src/app/docs");
  return readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => readFileSync(join(e.parentPath ?? dir, e.name), "utf-8"))
    .join("\n");
}

const PAGES = docsSource();
const CLIENT = read("packages/agent-kit/src/client.ts");
const CONTRACTS = ["Market", "AgentRegistry", "MarketFactory"]
  .map((c) => read(`contracts/src/core/${c}.sol`))
  .join("\n");

describe("the documentation does not describe things that are not there", () => {
  it("reads more than one page", () => {
    // The concatenation is doing real work; a broken glob would quietly reduce
    // every assertion below to a check against an empty string.
    expect(PAGES.length).toBeGreaterThan(20_000);
    expect(PAGES).toContain("DocPage");
  });

  it("names only SDK methods that exist", () => {
    const claimed = new Set<string>();
    for (const [, sig] of PAGES.matchAll(/sig: "([^"]+)"/g)) {
      for (const [, name] of sig.matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*[(·]/g)) claimed.add(name);
    }
    const real = new Set([...CLIENT.matchAll(/^\s*async ([a-zA-Z][a-zA-Z0-9]*)\(/gm)].map((m) => m[1]!));

    expect(claimed.size).toBeGreaterThan(15);
    expect([...claimed].filter((n) => !real.has(n))).toEqual([]);
  });

  it("names only contract errors that exist", () => {
    const claimed = [...PAGES.matchAll(/name: "([A-Z][A-Za-z]+)"/g)].map((m) => m[1]!);
    const real = new Set([...CONTRACTS.matchAll(/error ([A-Za-z]+)\(/g)].map((m) => m[1]!));

    expect(claimed.length).toBeGreaterThan(8);
    expect(claimed.filter((n) => !real.has(n))).toEqual([]);
  });

  /**
   * The rename left three references to Gensyn's Delphi in the codebase on
   * purpose. The docs may name it too — but only as somebody else's product,
   * never as this one.
   */
  it("never calls this product Delphi", () => {
    // Both sides of the word: "a Delphi agent" qualifies it AFTER the mention,
    // and a window that only looks backwards reports it as bare.
    const bare = [...PAGES.matchAll(/.{0,70}\bDelphi\b.{0,30}/g)].map((m) => m[0]);
    for (const context of bare) {
      // The possessive is written `Delphi&rsquo;s` in JSX, so a matcher looking
      // for a literal apostrophe rejects a mention that is properly qualified.
      expect(context, `"Delphi" used without saying whose: …${context}`).toMatch(
        /Gensyn|Delphi(&rsquo;s|&#39;s|'s|’s)?\s+(SDK|agent|competition)/,
      );
    }
  });

  /**
   * Addresses and the deployment block, against the manifest the frontend and
   * every agent actually read. A configuration reference whose addresses have
   * gone stale is worse than none: it reads authoritatively and points at
   * nothing, and a reader gets an empty market list with no error to explain it.
   */
  it("quotes addresses that match the live manifest", () => {
    const {contracts, deploymentBlock} = JSON.parse(read("deployments/16602.json")) as {
      contracts: Record<string, string>;
      deploymentBlock: number;
    };

    expect(PAGES).toContain(String(deploymentBlock));
    // The faucet is the one address a reader must paste, so it is quoted whole.
    expect(PAGES).toContain(contracts.MockUSDC);

    // The rest are abbreviated: the page tells readers to take them from the
    // manifest, and a full stale address invites a copy. They still have to be
    // abbreviations OF something real.
    for (const name of ["MarketFactory", "AgentRegistry", "ResolutionModule", "OutcomeShares", "ConfigRegistry"]) {
      const addr = contracts[name]!;
      expect(PAGES, `${name} is not quoted correctly`).toContain(`${addr.slice(0, 10)}…${addr.slice(-4)}`);
    }
  });

  it("quotes economic parameters that match the deployment defaults", () => {
    const lib = read("contracts/script/DeployLib.sol");
    // Read the intent from the deploy script rather than trusting the page.
    expect(lib).toContain("setParam(ConfigKeys.FEE_BPS, 100)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_FAST, 24 hours)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_VERIFIED, 6 hours)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_DETERMINISTIC, 2 hours)");

    expect(PAGES).toContain("FEE_BPS            100");
    expect(PAGES).toContain('["FAST", "1 resolver", "24 hours"]');
    expect(PAGES).toContain('["VERIFIED", "3 of 5 must agree", "6 hours"]');
    expect(PAGES).toContain('["DETERMINISTIC", "2 of 3 must agree", "2 hours"]');
  });
});
