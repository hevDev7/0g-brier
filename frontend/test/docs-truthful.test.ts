import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

/**
 * The documentation's reference section names real methods and real errors.
 *
 * This reads the source rather than rendering the page, because the failure it
 * guards against is a rename: `DelphiZeroClient` became `BrierClient` in a single
 * sweep, and a reference that had documented the old name would have gone on
 * looking authoritative while sending every reader to a method that no longer
 * exists. Docs do not fail loudly on their own — nothing imports them.
 *
 * Deliberately textual. The frontend cannot import `@brier/agent-kit`: a test
 * enforces that it holds no write path to the chain, and adding the dependency to
 * check a doc string would be a strange way to lose that guarantee.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const PAGE = read("frontend/src/app/docs/page.tsx");
const CLIENT = read("packages/agent-kit/src/client.ts");
const CONTRACTS = ["Market", "AgentRegistry", "MarketFactory"]
  .map((c) => read(`contracts/src/core/${c}.sol`))
  .join("\n");

describe("the documentation does not describe things that are not there", () => {
  it("names only SDK methods that exist", () => {
    const claimed = new Set<string>();
    for (const [, sig] of PAGE.matchAll(/sig: "([^"]+)"/g)) {
      for (const [, name] of sig.matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*[(·]/g)) claimed.add(name);
    }
    const real = new Set([...CLIENT.matchAll(/^\s*async ([a-zA-Z][a-zA-Z0-9]*)\(/gm)].map((m) => m[1]!));

    expect(claimed.size).toBeGreaterThan(15);
    expect([...claimed].filter((n) => !real.has(n))).toEqual([]);
  });

  it("names only contract errors that exist", () => {
    const claimed = [...PAGE.matchAll(/name: "([A-Z][A-Za-z]+)"/g)].map((m) => m[1]!);
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
    const asOurs = PAGE.match(/\bDelphi\b(?![\s'’]*(SDK|agent|competition))/g) ?? [];
    const contexts = asOurs.map(() => {
      const i = PAGE.indexOf("Delphi");
      return PAGE.slice(Math.max(0, i - 60), i + 40);
    });
    for (const c of contexts) {
      expect(c, `"Delphi" used without saying whose: ${c}`).toMatch(/Gensyn|Delphi SDK|Delphi agent/);
    }
  });

  /**
   * Addresses and the deployment block, against the manifest the frontend and
   * every agent actually read. A configuration reference whose addresses have
   * gone stale is worse than none: it looks authoritative and points at nothing,
   * and a reader gets an empty market list with no error to explain it.
   */
  it("quotes addresses that match the live manifest", () => {
    const manifest = JSON.parse(read("deployments/16602.json"));
    const {contracts, deploymentBlock} = manifest as {
      contracts: Record<string, string>;
      deploymentBlock: number;
    };

    expect(PAGE).toContain(String(deploymentBlock));

    // The faucet is the one address a reader must paste, so it is quoted whole.
    expect(PAGE).toContain(contracts.MockUSDC);

    // The rest are abbreviated on purpose — the page tells readers to take them
    // from the manifest, and a full stale address invites a copy. Abbreviations
    // still have to be abbreviations OF something real.
    for (const name of ["MarketFactory", "AgentRegistry", "ResolutionModule", "OutcomeShares", "ConfigRegistry"]) {
      const addr = contracts[name]!;
      const abbreviated = `${addr.slice(0, 10)}…${addr.slice(-4)}`;
      expect(PAGE, `${name} is not quoted as ${abbreviated}`).toContain(abbreviated);
    }
  });

  it("quotes economic parameters that match the deployment defaults", () => {
    const lib = read("contracts/script/DeployLib.sol");
    // Read the intent from the deploy script rather than trusting the page.
    expect(lib).toContain("setParam(ConfigKeys.FEE_BPS, 100)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_FAST, 24 hours)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_VERIFIED, 6 hours)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_DETERMINISTIC, 2 hours)");

    expect(PAGE).toContain("FEE_BPS            100");
    expect(PAGE).toContain('["FAST", "1 resolver", "24 hours"]');
    expect(PAGE).toContain('["VERIFIED", "3 of 5 must agree", "6 hours"]');
    expect(PAGE).toContain('["DETERMINISTIC", "2 of 3 must agree", "2 hours"]');
  });
});
