// The feedback message a grown-up reads, then sends by email or copies. Nothing here talks to
// the network; the pane shows exactly this text before anything leaves the Mac.
import { PRODUCT_NAME } from "../../brand";
import type { ReadingLevel } from "../family/children";
import { redactForFeedback, removeNames } from "./redact";

export const FEEDBACK_EMAIL = "hello@skycot.com";

export const FEEDBACK_TYPES = [
  { id: "broke", label: "Something broke", subject: "Something broke" },
  { id: "confusing", label: "Confusing", subject: "Confusing" },
  { id: "idea", label: "Idea", subject: "Idea" },
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]["id"];

export const READING_LEVEL_NAMES: Readonly<Record<ReadingLevel, string>> = {
  "little-makers": "Little makers (5–7)",
  makers: "Makers (8–10)",
  "big-makers": "Big makers (11–13)",
};

export interface FeedbackDetails {
  readonly appVersion: string;
  readonly engineVersion: string | null;
  readonly computer: string | null;
  readonly familyProfileOn: boolean;
  readonly readingLevel: ReadingLevel | null;
  readonly logLines: ReadonlyArray<string>;
}

export const MAX_LOG_LINES = 20;

/** The detail lines, as the grown-up will read them. Names never appear; paths, codes and addresses are removed. */
export function detailLines(
  details: FeedbackDetails,
  childNames: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  const lines = [
    `${PRODUCT_NAME} version: ${details.appVersion}`,
    ...(details.engineVersion ? [`Engine version: ${details.engineVersion}`] : []),
    ...(details.computer ? [`Computer: ${details.computer}`] : []),
    `Family profile: ${details.familyProfileOn ? "on" : "off"}`,
    ...(details.readingLevel
      ? [`Reading level: ${READING_LEVEL_NAMES[details.readingLevel]}`]
      : []),
  ];
  const log = details.logLines
    .slice(-MAX_LOG_LINES)
    .map((line) => removeNames(redactForFeedback(line), childNames).trim())
    .filter((line) => line.length > 0);
  return log.length === 0
    ? [...lines, "Recent engine messages: none"]
    : [...lines, "Recent engine messages:", ...log.map((line) => `  ${line}`)];
}

export function feedbackSubject(type: FeedbackType): string {
  const entry = FEEDBACK_TYPES.find((item) => item.id === type)!;
  return `${PRODUCT_NAME} feedback: ${entry.subject}`;
}

export function buildReport(input: {
  readonly type: FeedbackType;
  readonly message: string;
  /** Null when "Include details" is off: nothing but the typed message is sent. */
  readonly details: FeedbackDetails | null;
  readonly childNames?: ReadonlyArray<string>;
}): string {
  const message = input.message.trim();
  const parts = [message.length > 0 ? message : "(no message)"];
  if (input.details !== null) {
    parts.push("", "--- Details ---", ...detailLines(input.details, input.childNames ?? []));
  }
  return parts.join("\n");
}

export function mailtoUrl(type: FeedbackType, report: string): string {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(feedbackSubject(type))}&body=${encodeURIComponent(report)}`;
}
