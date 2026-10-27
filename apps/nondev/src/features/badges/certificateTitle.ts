import { findPersonalDetails, replacePersonalDetails } from "@t3tools/skycot-rules/personal";

const TITLE_MAX = 60;

/** A saved conversation title can contain details the message shield would catch. */
export function certificateTitle(title: string): string | null {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const safe = replacePersonalDetails(clean, findPersonalDetails(clean));
  return safe.length <= TITLE_MAX ? safe : `${safe.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}
