// The fridge's sidebar glyph: a fridge door with a round magnet holding a little drawing.
// Drawn inline at the sidebar icon size, in the current text colour.
export function FridgeIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <path d="M5 9h14M8 5.5v1.5M8 11.5v2" />
      <rect x="10.5" y="12" width="6" height="6.5" rx="0.8" />
      <circle cx="13.5" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}
