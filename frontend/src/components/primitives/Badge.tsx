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

export function Badge({tone, label}: {tone: Tone; label: string}) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] uppercase ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}
