import {useId} from "react";

/**
 * The Brier mark: a ribbon folded into a B, traced from the brand original.
 *
 * Always drawn on its own dark tile rather than bare. The gradient's deep end
 * (#1c16b8) sits at only 1.53:1 against the dark theme's background, so a bare
 * mark would lose its lower fold there entirely. On the tile the mark keeps the
 * backdrop it was designed against, identically in both themes and in the
 * favicon — one brand presentation, not three.
 */
export function BrierMark({size = 32, className}: {size?: number; className?: string}) {
  // Gradient ids are document-global, so the header and footer copies would
  // otherwise share one definition and the second would render unpainted.
  // useId's value carries characters that are not valid in a url(#…) reference,
  // hence the strip.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const base = `brier-b-${uid}`;
  const rim = `brier-r-${uid}`;
  const clip = `brier-c-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      // Decorative in both placements: the header pairs it with the BRIER
      // wordmark inside the same link, and the footer is already all text.
      aria-hidden
      focusable="false"
      className={className}
    >
      <defs>
        <linearGradient id={base} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.0" stopColor="#4a70ec" />
          <stop offset="0.08" stopColor="#4066ea" />
          <stop offset="0.28" stopColor="#3d64f1" />
          <stop offset="0.42" stopColor="#2b4ce8" />
          <stop offset="0.58" stopColor="#172dd5" />
          <stop offset="0.72" stopColor="#4045e9" />
          <stop offset="0.78" stopColor="#4447eb" />
          <stop offset="0.88" stopColor="#302dda" />
          <stop offset="1.0" stopColor="#1c16b8" />
        </linearGradient>
        {/* Rim light along the top edge, perpendicular to it — the original's
            specular highlight runs parallel to that edge. */}
        <linearGradient id={rim} gradientUnits="userSpaceOnUse" x1="78" y1="44" x2="43.6" y2="105">
          <stop offset="0" stopColor="#a8c8ff" stopOpacity="0.62" />
          <stop offset="0.55" stopColor="#a8c8ff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#a8c8ff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          <path d="M 4.47 2.52 L 145.83 82.26 A 20.00 20.00 0 0 1 156.00 99.68 L 156.00 163.48 A 18.00 18.00 0 0 1 146.84 179.16 L 89.64 211.39 A 3.00 3.00 0 0 0 89.64 216.61 L 145.82 248.26 A 20.00 20.00 0 0 1 156.00 265.69 L 156.00 328.95 A 3.00 3.00 0 0 1 151.56 331.58 L 11.47 255.25 A 22.00 22.00 0 0 1 0.00 235.93 L 0.00 183.08 A 5.00 5.00 0 0 1 2.74 178.61 L 87.78 135.63 A 2.00 2.00 0 0 0 87.91 132.13 L 2.41 80.46 A 5.00 5.00 0 0 1 0.00 76.18 L 0.00 5.14 A 3.00 3.00 0 0 1 4.47 2.52 Z" />
          <path d="M 1.86 87.47 L 6.86 88.72 A 1.50 1.50 0 0 1 8.00 90.17 L 8.00 170.57 A 1.50 1.50 0 0 1 5.83 171.91 L 0.83 169.41 A 1.50 1.50 0 0 1 0.00 168.07 L 0.00 88.92 A 1.50 1.50 0 0 1 1.86 87.47 Z" />
        </clipPath>
      </defs>
      <rect width="512" height="512" rx="112" fill="#000514" />
      <g transform="translate(157.95 46.08) scale(1.25701)" clipPath={`url(#${clip})`}>
        <rect width="156" height="334" fill={`url(#${base})`} />
        <rect width="156" height="334" fill={`url(#${rim})`} />
      </g>
    </svg>
  );
}
