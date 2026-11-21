import type { ArtKind } from "./data";

/** Flat product illustrations, shapes only (no text), so they render the same on any machine and in a font-less container. */
export function artSvg(kind: ArtKind, hue: number): string {
  const main = `hsl(${hue} 55% 52%)`;
  const dark = `hsl(${hue} 55% 34%)`;
  const light = `hsl(${hue} 60% 88%)`;
  const shapes: Record<ArtKind, string> = {
    pen: `<rect x="228" y="70" width="44" height="260" rx="14" fill="${main}"/><rect x="228" y="70" width="44" height="60" rx="14" fill="${dark}"/><polygon points="228,330 272,330 250,392" fill="${light}"/><polygon points="240,366 260,366 250,392" fill="#222"/><rect x="262" y="150" width="8" height="120" rx="4" fill="${light}" opacity=".6"/>`,
    notebook: `<rect x="130" y="70" width="240" height="320" rx="14" fill="${main}"/><rect x="130" y="70" width="34" height="320" rx="10" fill="${dark}"/><rect x="190" y="120" width="150" height="26" rx="6" fill="${light}"/><rect x="190" y="164" width="110" height="14" rx="5" fill="${light}" opacity=".7"/>`,
    sack: `<path d="M150 120 Q250 60 350 120 L372 380 Q250 410 128 380 Z" fill="${main}"/><rect x="190" y="200" width="120" height="110" rx="12" fill="${light}"/><path d="M150 120 Q250 150 350 120" stroke="${dark}" stroke-width="10" fill="none"/>`,
    milk: `<rect x="170" y="140" width="160" height="250" rx="14" fill="${light}"/><polygon points="170,140 250,70 330,140" fill="${main}"/><rect x="170" y="230" width="160" height="90" fill="${main}"/>`,
    box: `<rect x="120" y="150" width="260" height="230" rx="12" fill="${main}"/><rect x="120" y="150" width="260" height="56" rx="12" fill="${dark}"/><rect x="200" y="250" width="100" height="70" rx="8" fill="${light}"/>`,
    bottle: `<rect x="225" y="60" width="50" height="60" rx="10" fill="${dark}"/><rect x="190" y="115" width="120" height="280" rx="34" fill="${main}"/><rect x="205" y="220" width="90" height="100" rx="10" fill="${light}"/>`,
    can: `<ellipse cx="250" cy="120" rx="98" ry="30" fill="${light}"/><rect x="152" y="120" width="196" height="240" fill="${main}"/><ellipse cx="250" cy="360" rx="98" ry="30" fill="${main}"/><rect x="152" y="190" width="196" height="100" fill="${light}"/>`,
    paper: `<rect x="140" y="90" width="220" height="290" rx="8" fill="#ffffff" stroke="${dark}" stroke-width="6"/><rect x="170" y="140" width="160" height="12" rx="5" fill="${main}"/><rect x="170" y="176" width="160" height="12" rx="5" fill="${light}"/><rect x="170" y="212" width="120" height="12" rx="5" fill="${light}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 460" width="1000" height="920"><rect width="500" height="460" fill="#f4f1ea"/>${shapes[kind]}</svg>`;
}
