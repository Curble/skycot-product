import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

// nondev-seam: brand-scheme-cors
const DESKTOP_SCHEME = process.env.T3CODE_DESKTOP_SCHEME ?? "t3code";
export const DESKTOP_RENDERER_ORIGINS = [
  `${DESKTOP_SCHEME}://app`,
  `${DESKTOP_SCHEME}-dev://app`,
] as const;
