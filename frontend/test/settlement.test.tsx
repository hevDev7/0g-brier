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

  // Pola yang sama dengan simulated-badge milik ResolutionEvidence di bawah —
  // dicek di sini juga karena verdict (pemenang + kurs payout) sama-sama tidak
  // boleh disangka sungguhan saat berasal dari receipt stub.
  it("menandai hasil tersimulasi secara mencolok juga di panel outcome final", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    expect(screen.getByTestId("final-outcome-simulated")).toHaveTextContent(/simulasi/i);
  });

  it("tidak menandai simulasi di panel outcome final saat receipt sungguhan", () => {
    render(<FinalOutcome receipt={{...receipt, simulated: false}} market={m} />);
    expect(screen.queryByTestId("final-outcome-simulated")).not.toBeInTheDocument();
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

describe("ResolutionEvidence — market belum diselesaikan", () => {
  // Setara PENDING_RECEIPT di lib/data/mock.ts (tidak diekspor dari sana,
  // jadi ditulis ulang di sini) — bentuk yang dikembalikan getReceipt() untuk
  // market mana pun yang statusnya BUKAN Settled: dua dari tiga fixture
  // market memakai bentuk ini, bukan kasus tepi langka.
  const pending: SettlementReceipt = {
    outcome: null,
    votes: [],
    judgeModel: null,
    reasoning: "",
    criteria: "",
    sources: [],
    provider: "0x0000000000000000000000000000000000000000",
    chatId: "",
    simulated: true,
  };

  it("menampilkan pesan belum-diselesaikan, bukan panel kosong tak berpenjelasan", () => {
    render(<ResolutionEvidence receipt={pending} />);
    expect(screen.getAllByText(/belum diselesaikan/i).length).toBeGreaterThan(0);
  });

  // Inti perbaikan: sebelum ini, judul "Kriteria resolusi" merender paragraf
  // kosong dan <details> "lengkap, apa adanya" membuka ke ketiadaan — disclosure
  // yang menjanjikan isi lengkap lalu tidak memberi apa-apa. Itu terbaca sebagai
  // "resolusi terjadi dan tidak menghasilkan apa-apa", bukan "belum ada
  // resolusi", persis kebohongan yang dilarang aturan #1 file komponen ini.
  it("tidak menjanjikan kriteria maupun alasan lengkap yang sebenarnya kosong", () => {
    render(<ResolutionEvidence receipt={pending} />);
    expect(screen.queryByTestId("criteria")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reasoning")).not.toBeInTheDocument();
  });
});
