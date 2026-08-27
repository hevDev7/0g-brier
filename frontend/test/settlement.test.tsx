import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {FinalOutcome} from "@/components/settlement/FinalOutcome";
import {ResolutionEvidence} from "@/components/settlement/ResolutionEvidence";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {SettlementReceipt} from "@/lib/data/types";

const m = FIXTURE_MARKETS[0]!;
const receipt: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  reasoning: "Dua dari tiga resolver menyimpulkan YES.",
  criteria: "YES bila harga penutupan di atas $4.000.",
  sources: ["https://example.org/data"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
};

describe("FinalOutcome", () => {
  it("menyebut pemenang dan kurs payout-nya", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    expect(screen.getByTestId("winner")).toHaveTextContent("YES");
    expect(screen.getByTestId("payout")).toHaveTextContent("×");
  });

  it("kurs payout memakai 1/p, bukan 1/P", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    // q fixture memberi P(YES)=59,0% -> p=0,7681 -> 1/p = 1,30x. 1/P akan 1,69x.
    expect(screen.getByTestId("payout")).toHaveTextContent("1.30×");
    expect(screen.getByTestId("payout")).not.toHaveTextContent("1.69×");
  });
});

describe("ResolutionEvidence", () => {
  it("menampilkan setiap model resolver dan suaranya", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    for (const v of receipt.votes) expect(screen.getByText(v.model)).toBeInTheDocument();
  });

  it("menampilkan alasan verbatim, tanpa dipangkas", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("reasoning")).toHaveTextContent(receipt.reasoning);
  });

  it("menampilkan kriteria resolusi dan sumber data", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("criteria")).toHaveTextContent(receipt.criteria);
    expect(screen.getByText(receipt.sources[0]!)).toBeInTheDocument();
  });

  it("menandai hasil tersimulasi secara mencolok", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("simulated-badge")).toHaveTextContent(/simulasi/i);
  });

  it("tidak menandai simulasi saat receipt sungguhan", () => {
    render(<ResolutionEvidence receipt={{...receipt, simulated: false}} />);
    expect(screen.queryByTestId("simulated-badge")).not.toBeInTheDocument();
  });

  it("menandai resolver yang suaranya berbeda dari outcome final", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("vote-qwen3-32b")).toHaveTextContent(/NO/);
  });
});
