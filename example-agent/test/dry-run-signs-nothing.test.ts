/**
 * A dry run cannot sign, and that is a property of the client rather than a
 * promise made by the loop.
 *
 * `connect` builds the SDK's own read-only client when `DRY_RUN` is set, rather
 * than loading a throwaway key. The alternative teaches the habit of pasting
 * keys into example projects, and one day the key is not a throwaway. The
 * client then refuses every write BY NAME and before any RPC round trip, so the
 * test below proves it without a chain to prove it against.
 *
 * The second half is a call-site scan. "Nothing is sent in a dry run" is a
 * statement about the ORDER of two branches in a function, which no type can
 * carry: move the `if (config.dryRun)` return below the buy and everything
 * still compiles.
 */
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {connect} from "../src/config.js";
import {fileNamed, loadSrc} from "./source.js";
import {startStubRpc} from "./stub-rpc.js";

const GALILEO = 16602;
const FACTORY = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const SHARES = "0x0123456789AbCdEf0123456789AbCdEf01234567";

/**
 * No manifest, so these addresses are the run's own — the shape a copied-out
 * project has. Pointed at this repository's `deployments/` instead, the run
 * would refuse them for disagreeing with the live Galileo deployment, which is
 * the refusal `config-refuses-to-guess.test.ts` covers.
 */
let noManifest: string;

beforeAll(() => {
  noManifest = mkdtempSync(join(tmpdir(), "brier-example-agent-nodeployments-"));
});
afterAll(() => {
  rmSync(noManifest, {recursive: true, force: true});
});

describe("the client a dry run gets cannot write", () => {
  it("has no wallet, and refuses a buy by name before it touches the network", async () => {
    const stub = await startStubRpc(GALILEO);
    try {
      const {config, client} = await connect({
        CHAIN_ID: String(GALILEO),
        DRY_RUN: "1",
        DRY_BUDGET: "1",
        RPC_URL: stub.url,
        DEPLOYMENTS_DIR: noManifest,
        FACTORY,
        OUTCOME_SHARES: SHARES,
      });
      expect(config.dryRun).toBe(true);
      expect(client.canWrite).toBe(false);
      expect(client.address).toBe(`0x${"0".repeat(40)}`);

      // The stub answers `eth_chainId` and nothing else, so if this rejection
      // came from anywhere but the signer guard the message would be a
      // transport error instead. It refuses before the first round trip.
      await expect(
        client.buyShares({market: FACTORY, outcome: 1, sharesOut: 1n, maxTokensIn: 1n}),
      ).rejects.toThrow(/cannot buyShares/);
      await expect(client.redeem(FACTORY)).rejects.toThrow(/cannot redeem/);
    } finally {
      await stub.close();
    }
  }, 20_000);
});

describe("in the loop, the dry branch returns before anything is signed", () => {
  const files = loadSrc();
  const agent = fileNamed(files, "agent.ts");
  const redeem = fileNamed(files, "redeem.ts");

  it("scans the source it means to scan", () => {
    expect(agent.code).toContain("config.dryRun");
    expect(redeem.code).toContain("config.dryRun");
    // Both files must still be doing the thing whose ordering is under test.
    expect(agent.code).toContain("client.buyShares(");
    expect(redeem.code).toContain("client.redeem(");
    expect(redeem.code).toContain("client.liquidate(");
  });

  it("agent.ts reports the order it would have placed and returns", () => {
    const wouldBuy = agent.code.indexOf('return "would-trade"');
    expect(wouldBuy, "agent.ts no longer has a dry-run exit").toBeGreaterThan(-1);
    for (const write of ["client.ensureAllowance(", "client.buyShares("]) {
      expect(
        agent.code.indexOf(write),
        `agent.ts calls ${write} before its dry-run branch has returned`,
      ).toBeGreaterThan(wouldBuy);
    }
  });

  it("redeem.ts says what it would claim and returns", () => {
    // Two exits, because a settled market and a failed one are claimed by two
    // different functions with two different arithmetics.
    expect(redeem.code.indexOf("WOULD     redeem")).toBeGreaterThan(-1);
    expect(redeem.code.indexOf("client.redeem(")).toBeGreaterThan(redeem.code.indexOf("WOULD     redeem"));
    expect(redeem.code.indexOf("WOULD     liquidate")).toBeGreaterThan(-1);
    expect(redeem.code.indexOf("client.liquidate(")).toBeGreaterThan(redeem.code.indexOf("WOULD     liquidate"));
  });

  it("no file signs anything on its own account", () => {
    // Every write goes through the agent SDK, which is where the slippage
    // bound, the allowance and the registered-trader gate live. A raw
    // `writeContract` here would be a second, unguarded path to the same money.
    for (const file of files) {
      for (const forbidden of ["writeContract", "sendTransaction", "createWalletClient", "privateKeyToAccount"]) {
        expect(file.code, `src/${file.name} signs its own transactions`).not.toContain(forbidden);
      }
    }
  });
});
