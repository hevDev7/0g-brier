import type {ReactNode} from "react";

/**
 * The reference half of the documentation.
 *
 * Kept separate from the prose because it is read differently: nobody reads a
 * method table, they search it. So it is dense, alphabetical within its group,
 * and every entry carries the one thing that is not inferable from the signature
 * — what the call costs, what it can revert with, or which unit it speaks.
 */

export function MethodGroup({
  title,
  note,
  methods,
}: {
  title: string;
  note?: ReactNode;
  methods: {sig: string; does: ReactNode}[];
}) {
  return (
    <div>
      <p className="eyebrow mb-2 text-text-faint">{title}</p>
      {note && <p className="mb-3 text-[13px] leading-relaxed text-text-muted">{note}</p>}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full border-collapse text-[13px]">
          <tbody className="divide-y divide-border">
            {methods.map(({sig, does}) => (
              <tr key={sig}>
                <td className="w-[46%] px-4 py-3 align-top">
                  <code className="font-mono text-[12.5px] leading-relaxed break-words text-text">{sig}</code>
                </td>
                <td className="px-4 py-3 align-top leading-relaxed text-text-muted">{does}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ErrorTable({rows}: {rows: {name: string; when: string; fix: string}[]}) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border bg-bg-sunken text-left">
            {["Reverts with", "What happened", "What to do"].map((h) => (
              <th key={h} className="px-4 py-2.5 font-mono text-[11px] tracking-wider text-text-faint uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({name, when, fix}) => (
            <tr key={name}>
              <td className="px-4 py-3 align-top">
                <code className="font-mono text-[12.5px] whitespace-nowrap text-neg">{name}</code>
              </td>
              <td className="px-4 py-3 align-top leading-relaxed text-text-muted">{when}</td>
              <td className="px-4 py-3 align-top leading-relaxed text-text">{fix}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Their name on the left, ours on the right, and the trap in between. */
export function PortingTable({
  rows,
}: {
  rows: {from: string; to: string; trap?: ReactNode}[];
}) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border bg-bg-sunken text-left">
            {["Gensyn Delphi SDK", "Brier", "What changes"].map((h) => (
              <th key={h} className="px-4 py-2.5 font-mono text-[11px] tracking-wider text-text-faint uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({from, to, trap}) => (
            <tr key={from}>
              <td className="px-4 py-3 align-top">
                <code className="font-mono text-[12.5px] whitespace-nowrap text-text-muted">{from}</code>
              </td>
              <td className="px-4 py-3 align-top">
                <code className="font-mono text-[12.5px] whitespace-nowrap text-text">{to}</code>
              </td>
              <td className="px-4 py-3 align-top leading-relaxed text-text-muted">{trap ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
