# Demo video — full script

**2 minutes 10 seconds · 307 words · 142 words per minute.**

One claim, proved on camera: *this is a prediction market humans cannot trade on, and an
agent can.*

Every line under **SAY** is the exact narration. The pace was measured per section — none
of it forces you to rush, and the one slow section is slow on purpose.

Rehearsed against the live chain on 2026-08-29. The numbers spoken are the numbers the
commands produced. **If you record against a different market, re-read them off your own
screen** — that is the only way this script can make you say something untrue.

---

## Before you record

| Check | How | Expected |
|---|---|---|
| Production server up | `curl -o /dev/null -w '%{http_code}\n' https://brier.mdloglabs.org/` | `200` in ~0.2s |
| An Open market exists | the site's Live filter | at least 1 |
| Its window has hours left | market row, "CLOSES" column | not minutes |
| Agent runs, is funded, and declines | `BELIEF=0.50 npx tsx agent.ts` | wallet, identity, bankroll, then `no trade` |

That last row is the whole rehearsal in one command: it exercises the RPC, the 0G Storage
read and the edge check without spending anything, and its `bankroll` line doubles as the
balance check. If it prints a number and stops at `no trade`, the take will work.

The rehearsal used market `0x72f6C938…6f00` at **P(YES) 59.4%**, and `BELIEF=0.70`. The
impact cap binds at 500 bps regardless of belief, so the trade is the same for any belief
above about 62%: **76.15 mUSDC, moving 59.4% → 64.3%.** If that market has closed:

```
RPC=https://evmrpc-testnet.0g.ai STOP_AFTER_CREATE=1 TRADING_WINDOW_SECONDS=86400 \
  bash scripts/e2e-market.sh
```

A fresh market opens at 50.0% and one buy moves it to about 55% — so the numbers in
**THE PROOF** change. Rewrite that line before recording.

**Layout.** Browser left, terminal right, both visible throughout. The most persuasive
second in this video is a number changing in the browser because of something that
happened in the terminal, and that only lands if both are on screen at once.

---

## 0:00 – 0:15 · The claim
*30 words · 120 wpm · unhurried*

**ON SCREEN:** `brier.mdloglabs.org`, market list loaded. Slow scroll down the row.

**SAY:**

> This is Brier. A prediction market on 0G Chain. Real markets, real collateral, live
> probabilities. And there is no way for me to trade on it. That is the point.

**NOTE:** Do not cut after this. The next shot has to be continuous or it looks staged.

---

## 0:15 – 0:35 · The absence, shown
*46 words · 138 wpm*

**ON SCREEN:** click into the open market. Scroll the whole detail page, top to bottom, at
reading speed. Let the viewer look for a buy button and fail to find one.

**SAY:**

> Here is one of them. Probability, depth, the position book, the settlement receipt.
> Everything you need to judge a market. No connect-wallet button. No order ticket. And not
> hidden behind a flag: this page holds no private key, and a test fails if anyone adds one.

**OPTIONAL, 3 seconds, worth it:** Ctrl+F the page for "buy". Zero results — checked
against the rendered page, not just the design.

---

## 0:35 – 1:20 · The agent
*115 words · 153 wpm · the terminal is printing, so you have room*

**ON SCREEN:** terminal. Show `.env` first, three seconds, scrolled to the policy block —
point at `MAX_IMPACT_BPS=500`. Then run `npx tsx agent.ts` and let it print.

**SAY:**

> Trading happens here instead. This is the agent's entire configuration. Ten lines, and
> five of them decide how much it is willing to risk. Each one is a refusal, not a target.
>
> Now watch it work. It reads the market's question out of 0G Storage. It forms its own
> probability without being shown the market's, because a model told the market says
> fifty-nine percent will answer fifty-nine, and call it a forecast.
>
> Then the part that matters. Its bankroll cap allows a hundred and twenty-five thousand.
> Its impact cap allows seventy-six. Three orders of magnitude less, because a large order
> walks the price it is paying and buys away the edge it was sized from.

**NOTE:** The three paragraphs are three beats. Stop talking between them and let the
output catch up — the first four lines of the run deserve to be read, not talked over.

---

## 1:20 – 1:35 · The proof
*27 words · 108 wpm · deliberately slow — this is the shot*

**ON SCREEN:** the fill line lands with a transaction hash. Switch to the browser, reload,
wait for the table to fill.

**SAY:**

> Filled, with a transaction hash. And now the browser.
>
> *(pause while it loads)*
>
> Fifty-nine point four, to sixty-four point three. That number moved because of what just
> happened in the terminal.

**NOTE:** If you have to cut something for length, do not cut this. Everything else is a
claim; this is the evidence.

---

## 1:35 – 1:55 · Where the evidence lives
*50 words · 150 wpm · three cuts, roughly seven seconds each*

**ON SCREEN:** (1) an explorer contract page showing verified Solidity, (2)
`npmjs.com/package/@0g-brier/agent-kit`, (3) a settled market's resolution-evidence panel
with its 0G Storage root.

**SAY:**

> All fourteen contracts are verified on 0G's explorer, so you can read the Solidity. The
> SDK is three packages on npm, and that agent imported nothing else. And a settlement is
> not just resolved by AI: the receipt lives in 0G Storage, addressed by a Merkle root the
> contract recomputes.

---

## 1:55 – 2:10 · The close
*40 words · 160 wpm*

**ON SCREEN:** back to the market list.

**SAY:**

> Everything you just watched is live on Galileo right now. What is not done is the audit —
> these contracts hold money and have not been reviewed by anyone outside the team, and
> nothing goes to mainnet before that does.

**NOTE:** Ending on the gaps is deliberate. A judge who finds an unmentioned flaw discounts
everything else; a judge told about it first reads the rest as accurate.

---

## If something goes wrong on camera

| Symptom | Cause | Do this |
|---|---|---|
| `no trade — edge below the floor` | belief too close to the market | raise `BELIEF` to at least 3 points above P(YES) |
| Market list stuck on skeleton | chain read still running | wait — the public RPC is ~1.5s a call, it fills in a few seconds |
| `no trade — even the smallest size moves the price too far` | market too thin | create a new one with a larger seed |
| Buy reverts on slippage | somebody traded between quote and send | run it again — that is the guard working |

---

## What not to say

- Do not call anything "instant" or "real-time". Chain reads take seconds and the video
  shows it.
- Do not say agents **must** register. Trading is open on this deployment —
  `REQUIRE_REGISTERED_TRADER` is off, and it takes ten seconds to disprove.
- Do not read this script's numbers over a different market.
- Do not show a private key. `.env` may be on screen **only** with `AGENT_KEY` scrolled out
  of frame or redacted.
