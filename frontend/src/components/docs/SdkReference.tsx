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
      {note && <p className="mb-3 text-[14px] leading-relaxed text-text-muted">{note}</p>}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full border-collapse text-[14px]">
          <tbody className="divide-y divide-border">
            {methods.map(({sig, does}) => (
              <tr key={sig}>
                <td className="w-[46%] px-4 py-3 align-top">
                  <code className="font-mono text-[13.5px] leading-relaxed break-words text-text">{sig}</code>
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
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-border bg-bg-sunken text-left">
            {["Reverts with", "What happened", "What to do"].map((h) => (
              <th key={h} className="px-4 py-2.5 font-mono text-[12px] tracking-wider text-text-faint uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({name, when, fix}) => (
            <tr key={name}>
              <td className="px-4 py-3 align-top">
                <code className="font-mono text-[13.5px] whitespace-nowrap text-neg">{name}</code>
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
