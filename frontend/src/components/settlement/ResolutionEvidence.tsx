import {Badge} from "@/components/primitives/Badge";
import type {Outcome, ResolverVote, SettlementReceipt} from "@/lib/data/types";

function outcomeLabel(outcome: Outcome | null): string {
  if (outcome === null) return "belum memilih";
  return outcome === 1 ? "YES" : "NO";
}

/**
 * Satu baris suara resolver, berikut sisinya. Komite di fixture ini 2-1 DENGAN
 * SENGAJA — resolver yang berbeda pendapat tetap dirender di sini, dengan
 * alasannya sendiri terlihat lewat `reasoning` di bawah. Menyembunyikan suara
 * minoritas membuat konsensus terlihat lebih bulat daripada kenyataannya —
 * kebohongan sejenis dengan merender nol untuk data yang tak diketahui.
 */
function VoteRow({vote, finalOutcome}: {vote: ResolverVote; finalOutcome: Outcome | null}) {
  const dissents = finalOutcome !== null && vote.outcome !== null && vote.outcome !== finalOutcome;
  return (
    <li
      data-testid={`vote-${vote.model}`}
      className="flex items-center justify-between gap-3 py-1.5 text-[13px]"
    >
      <div className="flex items-center gap-2">
        {/* Nama model sengaja SATU elemen tanpa teks lain di dalamnya — getByText
            hanya menggabungkan node teks LANGSUNG suatu elemen, jadi frasa yang
            perlu cocok persis dengan nama model tidak boleh berbagi elemen
            dengan teks lain (lihat catatan yang sama di Unavailable.tsx). */}
        <span className="text-text">{vote.model}</span>
        {vote.teeVerified && <Badge tone="verified" label="TEE" />}
      </div>
      <div className="flex items-center gap-2">
        <span className={vote.outcome === 1 ? "text-pos" : vote.outcome === 0 ? "text-neg" : "text-text-faint"}>
          {outcomeLabel(vote.outcome)}
        </span>
        {dissents && <Badge tone="warning" label="Berbeda" />}
      </div>
    </li>
  );
}

/**
 * Bukti yang membuat resolusi bisa diperiksa, bukan sekadar dipercaya: suara
 * tiap resolver, kriteria yang dipakai, alasan apa adanya, dan sumber yang
 * dirujuk. Dua aturan yang tidak boleh dilanggar (spec F1 Task 6):
 *
 * 1. `reasoning` ditampilkan VERBATIM — boleh dilipat lewat <details>, tidak
 *    boleh diringkas maupun dipotong. Meringkasnya berarti UI ikut menilai
 *    argumen resolver, dan pembaca kehilangan justru bagian yang ingin ia
 *    periksa sendiri.
 * 2. `simulated: true` wajib mencolok — receipt stub tidak boleh pernah
 *    tertukar dengan yang sungguhan.
 */
export function ResolutionEvidence({receipt}: {receipt: SettlementReceipt}) {
  return (
    <div data-testid="resolution-evidence" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      {receipt.simulated && (
        <div
          data-testid="simulated-badge"
          role="status"
          className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-warn"
        >
          Hasil simulasi — bukan resolusi sungguhan dari komite AI
        </div>
      )}

      <div>
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Suara resolver</h2>
        {receipt.votes.length === 0 ? (
          <p className="text-[13px] text-text-muted">Belum ada suara resolver.</p>
        ) : (
          <ul className="divide-y divide-border">
            {receipt.votes.map((v) => (
              <VoteRow key={v.model} vote={v} finalOutcome={receipt.outcome} />
            ))}
          </ul>
        )}
        {receipt.judgeModel !== null && (
          <p className="mt-2 text-[12px] text-text-faint">
            Ringkasan di bawah disusun oleh juri: {receipt.judgeModel}
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Kriteria resolusi</h2>
        <p data-testid="criteria" className="text-[13px] leading-relaxed text-text">
          {receipt.criteria}
        </p>
      </div>

      <details data-testid="reasoning" className="text-[13px] leading-relaxed text-text">
        <summary className="cursor-pointer select-none text-text-muted">
          Alasan resolver — lengkap, apa adanya
        </summary>
        <p className="mt-2 whitespace-pre-wrap">{receipt.reasoning}</p>
      </details>

      <div>
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Sumber</h2>
        {receipt.sources.length === 0 ? (
          <p className="text-[13px] text-text-muted">Tidak ada sumber tercatat.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {receipt.sources.map((s) => (
              <li key={s}>
                <a
                  href={s}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[13px] text-accent underline underline-offset-2"
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
