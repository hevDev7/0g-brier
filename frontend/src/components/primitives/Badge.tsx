type Tone = "neutral" | "positive" | "negative" | "warning" | "verified";

const TONES: Record<Tone, string> = {
  neutral: "border-border text-text-muted",
  positive: "border-pos/40 text-pos",
  negative: "border-neg/40 text-neg",
  warning: "border-warn/40 text-warn",
  verified: "border-verified/40 text-verified",
};

export function Badge({tone, label}: {tone: Tone; label: string}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}
