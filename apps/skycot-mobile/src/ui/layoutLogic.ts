// nondev-seam: skycot-ipad-layout-logic
export const SPLIT_LAYOUT_MIN_WIDTH = 720;
export const SPLIT_LAYOUT_MIN_HEIGHT = 600;
export const SPLIT_SIDEBAR_MIN_WIDTH = 280;
const SPLIT_SIDEBAR_MAX_WIDTH = 380;

export type Layout =
  | { readonly variant: "compact"; readonly usesSplitView: false; readonly sidebarWidth: null }
  | { readonly variant: "split"; readonly usesSplitView: true; readonly sidebarWidth: number };

export function deriveLayout(input: { readonly width: number; readonly height: number }): Layout {
  if (input.width < SPLIT_LAYOUT_MIN_WIDTH || input.height < SPLIT_LAYOUT_MIN_HEIGHT) {
    return { variant: "compact", usesSplitView: false, sidebarWidth: null };
  }
  const sidebarWidth = Math.round(
    Math.min(Math.max(input.width * 0.32, SPLIT_SIDEBAR_MIN_WIDTH), SPLIT_SIDEBAR_MAX_WIDTH),
  );
  return { variant: "split", usesSplitView: true, sidebarWidth };
}
