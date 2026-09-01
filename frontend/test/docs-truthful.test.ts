import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

/**
 * The documentation's reference pages name real methods, real errors and real
 * addresses.
 *
 * This reads sources rather than rendering, because the failure it guards
 * against is a rename: the client class was renamed to `BrierClient` in a single sweep,
 * and a reference that had documented the old name would have gone on looking
 * authoritative while sending every reader to a method that no longer exists.
 * Documentation does not fail loudly on its own — nothing imports it.
 *
 * Deliberately textual. The frontend cannot import `@0g-brier/agent-kit`: a test
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

/** The same pages, kept apart, for claims about WHERE something is documented. */
function docsByPage(): Record<string, string> {
  const dir = join(ROOT, "frontend/src/app/docs");
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, {recursive: true, withFileTypes: true})) {
    if (!e.isFile() || e.name !== "page.tsx") continue;
    const parent = e.parentPath ?? dir;
    out[parent === dir ? "" : parent.slice(dir.length + 1)] = readFileSync(join(parent, e.name), "utf-8");
  }
  return out;
}

const PAGES = docsSource();

/**
 * The pages with their code samples removed.
 *
 * Some claims are about what the prose and the reference tables SAY, and a
 * sample that happens to share their shape is not making that claim. The error
 * check reads `name: "Something"` as naming a contract error, which is exactly
 * what an `ErrorTable` row is — and also what `registerAgent({name: "Pythia"})`
 * looks like inside a code block. Stripping the samples is narrower than
 * loosening the check, which would have stopped catching the invented error it
 * exists for.
 */
const PROSE = PAGES.replace(/\{`[\s\S]*?`\}/g, "");
const BY_PAGE = docsByPage();
const CLIENT = read("packages/agent-kit/src/client.ts");

/**
 * The reference documents three packages now, not one.
 *
 * `sig:` used to mean "a method on BrierClient", because that was the only
 * surface the docs described. The packages page describes two more, and a name
 * checked against the wrong package would be checked against nothing — so the
 * set of real names is the union of what all three actually declare. Read from
 * `src`, never `dist`: the built output is gitignored, and a test that needs a
 * build to pass is a test that passes for the wrong reason.
 */
const OTHER_PACKAGES = [
  ...readdirSync(join(ROOT, "packages/protocol/src"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => read(`packages/protocol/src/${f}`)),
  read("packages/zg-storage/src/index.ts"),
].join("\n");
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
    const both = `${CLIENT}\n${OTHER_PACKAGES}`;
    const real = new Set([
      // Methods, on the client and on the classes the other packages export.
      // `async` stays REQUIRED. Dropping it to catch a synchronous method would
      // also catch `if (`, `for (` and `return (` at the start of a line, and a
      // set of real names containing the language's keywords would wave through
      // very nearly anything.
      ...[...both.matchAll(/^\s*async ([a-zA-Z][a-zA-Z0-9]*)\(/gm)].map((m) => m[1]!),
      // Free functions, constants and classes.
      ...[...OTHER_PACKAGES.matchAll(/^export (?:declare )?(?:async )?(?:function|const|class) ([a-zA-Z][a-zA-Z0-9]*)/gm)].map(
        (m) => m[1]!,
      ),
    ]);

    expect(claimed.size).toBeGreaterThan(15);
    expect([...claimed].filter((n) => !real.has(n))).toEqual([]);
  });

  /**
   * The runbook page carries a whole agent rather than fragments, which is the
   * point of it — a reader copies the file and runs it. That makes every call
   * inside it a claim, and an unchecked one: nothing imports a code block, so a
   * renamed method would go on being printed, copied and run until somebody hit
   * the TypeError themselves.
   */
  it("only calls client methods that exist, in the code it tells readers to copy", () => {
    const called = [...new Set([...PAGES.matchAll(/\bbrier\.([a-zA-Z][a-zA-Z0-9]*)\(/g)].map((m) => m[1]!))];
    const real = new Set([...CLIENT.matchAll(/^\s*async ([a-zA-Z][a-zA-Z0-9]*)\(/gm)].map((m) => m[1]!));

    // The page is worth this test only while it still shows a working agent.
    expect(called.length).toBeGreaterThan(8);
    expect(called.filter((n) => !real.has(n))).toEqual([]);
  });

  /**
   * One configuration variable, one home.
   *
   * `.env` was described in two places at once: the connection settings under
   * "Setting it up" and the risk settings under the runbook, with the runbook
   * also printing the whole file. A reader filling in one file had to read two
   * pages to learn what its lines meant, and could not tell which page was the
   * one to follow. The split is now by PAGE rather than by variable — setup
   * installs and reads, the runbook configures and trades — and this keeps it
   * that way, because the cheapest way to undo it is to helpfully re-explain a
   * variable where it is first mentioned.
   */
  it("documents each configuration variable on exactly one page", () => {
    const vars = [
      "AGENT_KEY", "CHAIN_ID", "RPC_URL", "DEPLOYMENTS_DIR", "ZG_INDEXER", "AGENT_NAME",
      "MIN_EDGE_BPS", "BANKROLL_FRACTION_CAP", "MAX_IMPACT_BPS", "SLIPPAGE_BPS", "REVERSAL_EDGE_BPS",
    ];
    for (const v of vars) {
      const homes = Object.entries(BY_PAGE)
        .filter(([, src]) => src.includes(`sig: "${v}"`))
        .map(([slug]) => slug);
      expect(homes, `${v} is documented in ${homes.length} places`).toHaveLength(1);
      expect(homes[0], `${v} is documented away from the .env it belongs to`).toBe("running");
    }
  });

  /**
   * Two pages that both begin "install this and configure it" is the shape the
   * reader complained about. Each has to say where it stops and name the other.
   */
  it("keeps setup and the runbook pointed at each other", () => {
    expect(BY_PAGE.setup, "setup does not hand off").toContain('href="/docs/running"');
    expect(BY_PAGE.running, "the runbook does not say what it continues").toContain('href="/docs/setup"');
  });

  it("names only contract errors that exist", () => {
    const claimed = [...PROSE.matchAll(/name: "([A-Z][A-Za-z]+)"/g)].map((m) => m[1]!);
    const real = new Set([...CONTRACTS.matchAll(/error ([A-Za-z]+)\(/g)].map((m) => m[1]!));

    expect(claimed.length).toBeGreaterThan(8);
    expect(claimed.filter((n) => !real.has(n))).toEqual([]);
  });

  /**
   * The name is gone, and stays gone.
   *
   * This used to permit the word so long as it was attributed — the docs
   * carried a whole page on porting from it. That page was deleted on
   * 2026-08-29 and every remaining mention rewritten to name the MECHANISM
   * instead: an LMSR venue, the prior art, existing agent-trading SDKs. None of
   * the reasoning was lost, because none of it ever depended on whose product
   * it was. The check now covers the shipped surface rather than the docs
   * alone, since the comparison used to live in package comments too.
   */
  it("does not name another venue anywhere a reader can see", () => {
    const shipped = [
      PAGES,
      read("packages/agent-kit/src/types.ts"),
      read("packages/agent-kit/src/client.ts"),
      read("packages/agent-kit/examples/trade.ts"),
      read("packages/agent-kit/README.md"),
      read("README.md"),
    ].join("\n");

    // Written split so this assertion does not trip over its own source when
    // something greps the repository for the word.
    const banned = new RegExp(["Del", "phi"].join(""), "i");
    const hits = shipped
      .split("\n")
      .filter((l) => banned.test(l))
      .map((l) => l.trim().slice(0, 90));
    expect(hits, "the name is back").toEqual([]);
  });

  /**
   * Addresses and the deployment block, against the manifest the frontend and
   * every agent actually read. A configuration reference whose addresses have
   * gone stale is worse than none: it reads authoritatively and points at
   * nothing, and a reader gets an empty market list with no error to explain it.
   */
  it("quotes addresses that match the live manifest", () => {
    // 16661, because the docs describe mainnet. This read is the whole point of the
    // test: the pages quote whichever chain the manifest names, so pointing it at a
    // deployment the docs no longer describe would pass while proving nothing.
    const {contracts, deploymentBlock} = JSON.parse(read("deployments/16661.json")) as {
      contracts: Record<string, string>;
      deploymentBlock: number;
    };

    expect(PAGES).toContain(String(deploymentBlock));
    // The collateral is the one address a reader must paste, so it is quoted whole.
    // On mainnet that is W0G — a real token with no faucet, which is why the pages
    // now tell a reader to wrap rather than to claim.
    expect(PAGES).toContain(contracts.MockUSDC);

    // The rest are abbreviated: the page tells readers to take them from the
    // manifest, and a full stale address invites a copy. They still have to be
    // abbreviations OF something real.
    for (const name of ["MarketFactory", "AgentRegistry", "ResolutionModule", "OutcomeShares", "ConfigRegistry"]) {
      const addr = contracts[name]!;
      expect(PAGES, `${name} is not quoted correctly`).toContain(`${addr.slice(0, 10)}…${addr.slice(-4)}`);
    }
  });

  /**
   * The money map, against the script that sets it.
   *
   * A settlement pays five parties and only two of them have to ask, which is
   * the sort of thing a reader plans income around. Every share and deadline the
   * runbook quotes is read back from `DeployLib` here, because a percentage that
   * has drifted reads exactly as authoritative as one that has not.
   */
  it("quotes the settlement split and the claim deadlines the deployment actually sets", () => {
    const lib = read("contracts/script/DeployLib.sol");
    expect(lib).toContain("setParam(ConfigKeys.CREATOR_FEE_SHARE_BPS, 4000)");
    expect(lib).toContain("setParam(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 3000)");
    // `20 * unit`, not `20e6`. The literal was written for a 6-decimal testnet
    // stablecoin and was wrong by twelve orders of magnitude against the
    // 18-decimal mainnet collateral; the deploy now scales every money default by
    // the collateral's own decimals. The page must not name a token either — the
    // deposit is twenty whole units of whatever a given market settles in.
    expect(lib).toContain("setParam(ConfigKeys.MIN_SETTLEMENT_DEPOSIT, 20 * unit)");
    expect(lib).toContain("setParam(ConfigKeys.SWEEP_UNCLAIMED_AFTER, 365 days)");
    expect(lib).toContain("setParam(ConfigKeys.UNSTAKE_COOLDOWN, 7 days)");

    const running = BY_PAGE.running!;
    expect(running, "the creator's share").toContain("40% of the fee");
    expect(running, "the resolver pool's share").toContain("30% of the fee");
    expect(running, "the treasury's remainder").toContain("remaining 30% of the fee");
    // The deposit is a PROTOCOL RULE, so it must not name a token: it is twenty
    // whole units of whatever a given market settles in. The page's other mUSDC
    // mentions are a transcript of a real Galileo session and are left alone —
    // rewriting them to say W0G would make the record false rather than general.
    // One whole unit, not twenty: MIN_SETTLEMENT_DEPOSIT is 1e18 on 16661 against an
    // 18-decimal collateral. The unit is still not named — the deposit is a protocol
    // rule, and a page that says "W0G" here would be wrong on the next deployment.
    expect(running, "the settlement deposit").toContain("one whole unit");
    expect(running, "the deposit rule must not name a token").not.toMatch(
      /settlement deposit[^.]*mUSDC/,
    );
    expect(running, "the sweep deadline, in seconds").toContain("31536000");
    expect(running, "the unstake cooldown, in seconds").toContain("604800");

    // This assertion used to read `/no function that moves collateral out/`,
    // and it was right: the resolver share accrued and stayed there. The
    // contract has since grown `claim`, so the old wording is now the false
    // one, and a test that pins prose has to be moved when the code moves
    // under it — otherwise it starts defending a claim it was written to catch.
    //
    // What is pinned now is narrower and outlives the wording: the page must
    // name the function a resolver actually calls, and must not promise the
    // money to anyone who did not agree with the settled outcome.
    const mod = read("contracts/src/core/ResolutionModule.sol");
    expect(mod, "the function the page names must exist").toContain(
      "function claim(uint256 agentId, address to)",
    );
    expect(running, "the call a resolver makes").toMatch(/claim\(agentId, to\)/);
    expect(running, "who does not get paid").toMatch(/no-showed or dissented earns nothing/i);
  });

  it("quotes economic parameters that match the deployment defaults", () => {
    const lib = read("contracts/script/DeployLib.sol");
    // Read the intent from the deploy script rather than trusting the page.
    expect(lib).toContain("setParam(ConfigKeys.FEE_BPS, 100)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_FAST, 24 hours)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_VERIFIED, 6 hours)");
    expect(lib).toContain("setParam(ConfigKeys.DISPUTE_WINDOW_DETERMINISTIC, 2 hours)");

    // The committee shapes, packed as n * 256 + k. Read from the deploy script for
    // the same reason as the windows above: the page is the thing under test, so it
    // cannot also be the source of truth.
    expect(lib).toContain("setParam(ConfigKeys.COMMITTEE_FAST, (5 << 8) | 3)");
    expect(lib).toContain("setParam(ConfigKeys.COMMITTEE_VERIFIED, (5 << 8) | 3)");
    expect(lib).toContain("setParam(ConfigKeys.COMMITTEE_DETERMINISTIC, (3 << 8) | 2)");
    expect(lib).toContain("setParam(ConfigKeys.COMMITTEE_DISPUTE, (9 << 8) | 6)");

    expect(PAGES).toContain("FEE_BPS            100");
    expect(PAGES).toContain('["FAST", "3 of 5 must agree", "24 hours"]');
    expect(PAGES).toContain('["VERIFIED", "3 of 5 must agree", "6 hours"]');
    expect(PAGES).toContain('["DETERMINISTIC", "2 of 3 must agree", "2 hours"]');
    expect(PAGES).toContain('["dispute round", "6 of 9 must agree", "—"]');
  });

  /**
   * No tier is a committee of one, and every threshold is a real majority.
   *
   * FAST shipped as `(1 << 8) | 1` — one agent, deciding alone, on the tier with the
   * loosest evidence requirement — and the documentation described it as such quite
   * accurately, which is what makes a truthfulness test the wrong place to have
   * caught it. This checks the DEFAULTS themselves, not the prose about them.
   */
  it("ships no tier that a single resolver could decide", () => {
    const lib = read("contracts/script/DeployLib.sol");
    const shapes = [...lib.matchAll(/setParam\(ConfigKeys\.COMMITTEE_\w+, \((\d+) << 8\) \| (\d+)\)/g)];
    expect(shapes.length, "no committee shapes found — has the packing changed?").toBe(4);
    for (const [, nRaw, kRaw] of shapes) {
      const n = Number(nRaw);
      const k = Number(kRaw);
      expect(n, "a committee smaller than three").toBeGreaterThanOrEqual(3);
      expect(k, "a threshold larger than the committee").toBeLessThanOrEqual(n);
      // At or below half, two different answers could each clear the threshold.
      expect(k * 2, "a threshold that is not a majority").toBeGreaterThan(n);
    }
  });

  /**
   * Commands the documentation tells a reader to type must exist.
   *
   * This page once printed `npm run register`, `npm run scan`, `npm run claim`,
   * `npm run metadata` and `npm run whoami`. None of them existed anywhere the
   * reader could get: they were scripts in an agent project the author had
   * written and never shipped. A newcomer following the page reached a terminal
   * and got "Missing script", with nothing to tell them whether they had made a
   * mistake or the documentation had.
   */
  it("only tells the reader to run scripts that ship", () => {
    const examples = new Set(
      readdirSync(join(ROOT, "packages/agent-kit/examples")).filter((f) => f.endsWith(".ts")),
    );
    const referenced = [...PAGES.matchAll(/npx tsx examples\/([\w.-]+)/g)].map((m) => m[1]!);

    expect(referenced.length).toBeGreaterThan(2);
    expect(referenced.filter((f) => !examples.has(f))).toEqual([]);
  });

  it("does not invent npm scripts", () => {
    const claimed = [...PAGES.matchAll(/npm run ([\w-]+)/g)].map((m) => m[1]!);
    // agent-kit is the package the docs send people to. Anything claimed here
    // has to be a script it actually defines.
    const scripts = Object.keys(
      (JSON.parse(read("packages/agent-kit/package.json")) as {scripts?: Record<string, string>}).scripts ?? {},
    );
    expect(claimed.filter((c) => !scripts.includes(c))).toEqual([]);
  });

  /**
   * Every command carries the directory it runs in.
   *
   * The `Run` primitive requires a `cwd`, so this checks the primitive is the one
   * being used: a `Cmd` holding a shell invocation is a command with nowhere to
   * run it, which is the shape the complaint was about.
   */
  it("never prints a shell command without saying where to run it", () => {
    const bareShellCmds = [...PAGES.matchAll(/<Cmd>\{?`?([^`<]*(?:npx|npm|cast|git clone)[^`<]*)/g)].map(
      (m) => m[1]!.trim().split("\n")[0]!,
    );
    // `cast` lines are self-contained — they name an RPC and an address and run
    // from anywhere. Anything invoking the project's own tooling must not be bare.
    const projectCmds = bareShellCmds.filter((c) => /npx tsx|npm run/.test(c));
    expect(projectCmds).toEqual([]);
  });
});
