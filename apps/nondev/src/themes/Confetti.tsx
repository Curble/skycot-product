// One-shot confetti for "It's live". Renders nothing unless the theme asked
// for playful motion and the person has not asked for reduced motion; the
// pieces animate once (CSS, fill-mode forwards) and then sit still, so there is
// no continuously repainting layer.
import { useActiveTheme } from "./store";

const PIECES = 10;

export function useConfettiAllowed(): boolean {
  const theme = useActiveTheme();
  if (theme.flavour.motion !== "playful") return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
}

export function ConfettiBurst() {
  const allowed = useConfettiAllowed();
  if (!allowed) return null;
  return (
    <span className="fm-confetti" aria-hidden>
      {Array.from({ length: PIECES }, (_, index) => (
        <i key={index} className={`fm-confetti__piece fm-confetti__piece--${index}`} />
      ))}
    </span>
  );
}
