type Tone = "neutral" | "positive" | "negative" | "warning" | "verified";

/**
 * `neutral` is the default and carries no colour, because most badges label a
 * category rather than report a fact. A toned badge means its colour is saying
 * something the label alone does not.
 */
const TONES: Record<Tone, string> = {
  neutral: "border-border bg-bg-sunken text-text-muted",
  positive: "border-pos/35 bg-pos/10 text-pos",
  negative: "border-neg/35 bg-neg/10 text-neg",
  warning: "border-warn/35 bg-warn/10 text-warn",
  verified: "border-verified/35 bg-verified/10 text-verified",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-text-faint",
  positive: "bg-pos",
  negative: "bg-neg",
  warning: "bg-warn",
  verified: "bg-verified",
};

/**
 * `dot` is opt-in and is used for lifecycle STATUS only. A dot on every badge —
 * tier, TEE, dissent — would turn a signal into wallpaper; on a status badge it
 * is what lets a reader find the one row that is not Open without reading seven
 * words.
 */
export function Badge({
  tone,
  label,
  dot = false,
  title,
}: {
  tone: Tone;
  label: string;
  dot?: boolean;
  /** Hover text. Where a badge shows a derived state, this carries the raw one. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] whitespace-nowrap uppercase ${TONES[tone]}`}
    >
      {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOTS[tone]}`} />}
      {label}
    </span>
  );
}
