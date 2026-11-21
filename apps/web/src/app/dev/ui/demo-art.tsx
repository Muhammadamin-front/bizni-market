/**
 * Synthetic product illustrations for the gallery only. Real products show their MoySklad photo;
 * these stand in until the first sync, and are never shipped to the storefront.
 */
export type ArtKind = "pen" | "notebook" | "sack" | "milk" | "box" | "bottle";

const common = { viewBox: "0 0 120 120", "aria-hidden": true, className: "size-full" } as const;

export function DemoArt({ kind }: { kind: ArtKind }) {
  switch (kind) {
    case "pen":
      return (
        <svg {...common}>
          <g transform="rotate(-38 60 60)">
            <rect x="14" y="52" width="80" height="16" rx="3" fill="#4a4f57" />
            <rect x="14" y="52" width="22" height="16" rx="3" fill="#2a2d33" />
            <path d="M94 52 L112 60 L94 68 Z" fill="#c9ccd1" />
            <rect x="40" y="55" width="40" height="3" rx="1.5" fill="#8b9099" />
          </g>
        </svg>
      );
    case "notebook":
      return (
        <svg {...common}>
          <rect x="28" y="14" width="64" height="92" rx="4" fill="#7e9a86" />
          <rect x="28" y="14" width="10" height="92" rx="2" fill="#5f7a67" />
          <rect x="46" y="30" width="36" height="26" rx="2" fill="#f1ede4" />
          <rect x="50" y="36" width="28" height="3" rx="1.5" fill="#b9b3a6" />
          <rect x="50" y="43" width="20" height="3" rx="1.5" fill="#b9b3a6" />
        </svg>
      );
    case "sack":
      return (
        <svg {...common}>
          <path d="M34 22 H86 L92 36 V100 Q92 106 86 106 H34 Q28 106 28 100 V36 Z" fill="#cfae7e" />
          <path d="M34 22 H86 L90 32 H30 Z" fill="#b8955f" />
          <rect x="42" y="50" width="36" height="28" rx="3" fill="#f6f1e6" />
          <rect x="47" y="57" width="26" height="3" rx="1.5" fill="#b3a68c" />
          <rect x="47" y="64" width="18" height="3" rx="1.5" fill="#b3a68c" />
        </svg>
      );
    case "milk":
      return (
        <svg {...common}>
          <path d="M40 16 L80 16 L86 30 V104 Q86 108 82 108 H38 Q34 108 34 104 V30 Z" fill="#f4f1ea" stroke="#d6cfc2" strokeWidth="2" />
          <path d="M40 16 L60 6 L80 16 Z" fill="#e3ddd0" />
          <rect x="34" y="54" width="52" height="30" fill="#8aa9c4" />
          <rect x="44" y="63" width="32" height="4" rx="2" fill="#f4f1ea" />
        </svg>
      );
    case "box":
      return (
        <svg {...common}>
          <rect x="22" y="34" width="76" height="62" rx="4" fill="#c98f4a" />
          <rect x="22" y="34" width="76" height="14" rx="3" fill="#a9733a" />
          <rect x="34" y="60" width="52" height="24" rx="3" fill="#f6efe2" />
          <rect x="40" y="67" width="40" height="3.5" rx="1.75" fill="#c4b79d" />
          <rect x="40" y="74" width="26" height="3.5" rx="1.75" fill="#c4b79d" />
        </svg>
      );
    case "bottle":
      return (
        <svg {...common}>
          <rect x="50" y="10" width="20" height="18" rx="3" fill="#2f3a36" />
          <path d="M46 28 H74 V100 Q74 108 66 108 H54 Q46 108 46 100 Z" fill="#9fc2b6" />
          <rect x="46" y="58" width="28" height="26" fill="#f6f1e6" />
          <rect x="51" y="65" width="18" height="3" rx="1.5" fill="#b3a68c" />
        </svg>
      );
  }
}
