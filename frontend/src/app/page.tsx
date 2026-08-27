import Link from "next/link";
import {FIXTURE_MARKETS} from "@/lib/data/mock";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
      <h1 className="text-[20px] text-text">0G-Delphi</h1>
      <p className="text-[13px] text-text-muted">
        Mode mock. Daftar market penuh menyusul di F2, setelah MarketFactory mendarat.
      </p>
      <ul className="flex flex-col gap-2">
        {FIXTURE_MARKETS.map((m) => (
          <li key={m.address}>
            <Link
              href={`/market/${m.address}`}
              className="block rounded-lg border border-border px-4 py-3 text-[14px] text-text hover:border-accent"
            >
              {m.question}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
