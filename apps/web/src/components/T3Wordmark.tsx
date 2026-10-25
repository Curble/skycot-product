// nondev-seam: brand-advanced-mark
// SKYCOT's cloud (nondev/brand/assets/svg/mascot-minimal.svg), shown wherever the stock developer
// interface drew the T3 wordmark, so Advanced mode is still visibly SKYCOT (Mark, 25 Oct 2026).
import type { SVGProps } from "react";

const CLOUD =
  "M25 84A18 18 0 0 1 25.000 48.000L27.181 48A25 25 0 0 1 68.406 26.136A23 23 0 0 1 102.872 48.421A18 18 0 0 1 99.000 84.000ZM50 47a5 5 0 0 1 5 5v5a5 5 0 0 1 -10 0v-5a5 5 0 0 1 5 -5ZM74 47a5 5 0 0 1 5 5v5a5 5 0 0 1 -10 0v-5a5 5 0 0 1 5 -5Z";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="4 17 116 70" xmlns="http://www.w3.org/2000/svg">
      <path d={CLOUD} fill="#0071E3" fillRule="evenodd" />
    </svg>
  );
}

/** The cloud holding a left arrow: "back to SKYCOT". */
export function SkycotBackMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 10 124 80" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d={CLOUD} transform="translate(8 0)" fill="#0071E3" fillRule="evenodd" />
      <path
        d="M30 66H4m0 0 10-10M4 66l10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
