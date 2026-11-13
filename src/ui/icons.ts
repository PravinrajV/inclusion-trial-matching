/** Small Lucide-style icon set, inlined and bundled. No icon font or CDN. */
export type IconName =
  | "shield"
  | "lock"
  | "pin"
  | "cloud"
  | "cpu"
  | "file"
  | "print"
  | "sun"
  | "moon"
  | "check"
  | "x"
  | "help"
  | "chevron"
  | "map"
  | "list"
  | "home"
  | "spark"
  | "info";

const PATHS: Record<IconName, string> = {
  shield: `<path d="M12 3 5 6v6c0 4.2 2.8 7.4 7 8.5 4.2-1.1 7-4.3 7-8.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>`,
  lock: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  pin: `<path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.2"/>`,
  cloud: `<path d="M18 18H7a4 4 0 0 1-.6-8 6 6 0 0 1 11.2-1.7A3.5 3.5 0 0 1 18 18Z"/>`,
  cpu: `<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.8"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>`,
  file: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>`,
  print: `<path d="M6 9V4h12v5"/><path d="M6 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1"/><rect x="6" y="14" width="12" height="7"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/>`,
  moon: `<path d="M15 3a8 8 0 1 0 6 13 7 7 0 0 1-6-13Z"/>`,
  check: `<path d="m5 12 5 5L20 7"/>`,
  x: `<path d="M6 6 18 18M18 6 6 18"/>`,
  help: `<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.8.4-1.2.9-1.2 1.8V14"/><path d="M12 17h.01"/>`,
  chevron: `<path d="m8 6 6 6-6 6"/>`,
  map: `<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>`,
  list: `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`,
  home: `<path d="m4 11 8-7 8 7"/><path d="M6 10v10h12V10"/>`,
  spark: `<path d="M12 3v4M12 17v4M5 12H3M21 12h-2M7 7l-1.5-1.5M18.5 18.5 17 17M17 7l1.5-1.5M7 17l-1.5 1.5"/><circle cx="12" cy="12" r="2.4"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>`,
};

export function icon(name: IconName, className = "icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
