// nondev-seam: skycot-ipad-layout-hook
/**
 * Phone or iPad layout. Forked from T3 Code's apps/mobile/src/lib/layout.ts (`deriveLayout`,
 * MIT): the same breakpoints decide when there is room for a sidebar beside the content
 * (iPad, landscape or portrait; not in a narrow Split View or Slide Over window).
 */
import { useWindowDimensions } from "react-native";
import { deriveLayout, type Layout } from "./layoutLogic";

export {
  deriveLayout,
  SPLIT_LAYOUT_MIN_HEIGHT,
  SPLIT_LAYOUT_MIN_WIDTH,
  SPLIT_SIDEBAR_MIN_WIDTH,
} from "./layoutLogic";
export type { Layout } from "./layoutLogic";

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return deriveLayout({ width, height });
}

/** How wide a grid cell is: two across on a phone, three across beside the iPad's sidebar. */
export function useGridBasis(): "46%" | "30%" {
  return useLayout().usesSplitView ? "30%" : "46%";
}
