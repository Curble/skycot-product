// Titles a person chose with Rename, remembered on this device so the fridge, the recap and
// the certificate show them exactly as typed (plain/titles friendlyTitle leaves them alone).
// A convenience only: on another device a typed title still survives, because friendlyTitle
// only rewrites assistant-style Title Case names.
import { friendlyTitle } from "../../plain/titles";

const KEY = "skycot:renamed-titles";
const KEEP = 200;

function read(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function write(next: Record<string, string>) {
  try {
    const entries = Object.entries(next).slice(-KEEP);
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Private windows and blocked storage: the title is still shown, just friendlier.
  }
}

export function rememberRename(threadId: string, title: string): void {
  const next = read();
  delete next[threadId];
  next[threadId] = title;
  write(next);
}

export function forgetRename(threadId: string): void {
  const next = read();
  if (!(threadId in next)) return;
  delete next[threadId];
  write(next);
}

/** The title for a magnet, the recap or a certificate; the stored title is never changed. */
export function displayTitle(threadId: string | null, title: string): string {
  const renamed = threadId !== null && read()[threadId] === title.trim();
  return friendlyTitle(title, { renamed });
}
