/**
 * The large title on each section's first screen (Requests, Children, Make, …). It is drawn in
 * the page itself, in the iOS large-title style, rather than by the navigation bar: inside the
 * system tab bar the native large title doesn't show on iOS 26 with this navigation stack.
 */
import { createContext, type ReactNode } from "react";

// nondev-seam: skycot-ipad-root-header
export interface RootHeader {
  readonly route: string;
  readonly title: string;
  readonly right?: (() => ReactNode) | undefined;
  readonly leading?: ReactNode;
}

export const RootHeaderContext = createContext<RootHeader | null>(null);
