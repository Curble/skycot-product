/**
 * Phone or iPad layout. Forked from T3 Code's apps/mobile/src/lib/layout.ts (`deriveLayout`,
 * MIT): the same breakpoints decide when there is room for a sidebar beside the content
 * (iPad, landscape or portrait; not in a narrow Split View or Slide Over window).
 */
import { useWindowDimensions } from "react-native";

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

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return deriveLayout({ width, height });
}

/** How wide a grid cell is: two across on a phone, three across beside the iPad's sidebar. */
export function useGridBasis(): "46%" | "30%" {
  return useLayout().usesSplitView ? "30%" : "46%";
}
