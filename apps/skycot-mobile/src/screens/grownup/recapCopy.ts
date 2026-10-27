// nondev-seam: skycot-iphone-q39-recap-copy
import type { RecapMade } from "../../../../nondev/src/features/recap/recap";

export function mobileMadeSummary(made: RecapMade, childName: string): string | null {
  const files = new Set(
    made.changes
      .flatMap((change) => change.files.map((file) => file.path))
      .filter((path) => !/(?:^|\/)(?:node_modules|vendor|dist|build)(?:\/|$)/iu.test(path)),
  );
  if (files.size === 0) return null;
  return `${childName} changed ${files.size} ${files.size === 1 ? "thing" : "things"}.`;
}

export function mobileGrownUpLines(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  return lines.map((line) => (line.startsWith("SKYCOT added ") ? "SKYCOT added add-ons." : line));
}

export function mobileSwitchSummary(count: number): string | null {
  return count > 0 ? "Sam used a different helper for a bit." : null;
}

export function compactMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} m` : rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}
