/**
 * Two looks, each with light and dark: the familiar Apple one (grown-ups, and children whose
 * grown-up picked another look), and SKYCOT's Workshop (cream paper, ink outlines, marker
 * yellow; the children's default, as on the Mac: apps/nondev/src/themes/library/
 * workshop.theme.json). The system font throughout; Workshop uses its rounded design.
 */
import { createContext, use, useMemo, type ReactNode } from "react";
import { useColorScheme, type TextStyle } from "react-native";

export type LookId = "apple" | "workshop";

export interface Theme {
  readonly look: LookId;
  readonly dark: boolean;
  readonly color: {
    readonly background: string;
    readonly card: string;
    readonly cardRaised: string;
    readonly label: string;
    readonly label2: string;
    readonly label3: string;
    readonly separator: string;
    readonly fill: string;
    readonly accent: string;
    readonly accentSoft: string;
    readonly onAccent: string;
    readonly green: string;
    readonly orange: string;
    readonly red: string;
    readonly marker: string;
    readonly markerSoft: string;
    /** Workshop's ink outline; transparent in the Apple look. */
    readonly outline: string;
    readonly bubbleMe: string;
    readonly bubbleCrew: string;
  };
  readonly radius: { readonly card: number; readonly control: number; readonly bubble: number };
  /** Workshop's hard offset shadow; none in the Apple look. */
  readonly cardShadow: { readonly x: number; readonly y: number } | null;
  readonly font: { readonly family: TextStyle["fontFamily"] };
}

const APPLE_LIGHT: Theme = {
  look: "apple",
  dark: false,
  color: {
    background: "#F2F2F7",
    card: "#FFFFFF",
    cardRaised: "#FFFFFF",
    label: "#000000",
    label2: "#6C6C70",
    label3: "#8A8A8E",
    separator: "#C6C6C8",
    fill: "#E9E9EE",
    accent: "#0071E3",
    accentSoft: "#E1EEFC",
    onAccent: "#FFFFFF",
    green: "#248A3D",
    orange: "#C93400",
    red: "#D70015",
    marker: "#FFD166",
    markerSoft: "#FFF4D1",
    outline: "transparent",
    bubbleMe: "#0071E3",
    bubbleCrew: "#FFFFFF",
  },
  radius: { card: 12, control: 10, bubble: 18 },
  cardShadow: null,
  font: { family: undefined },
};

const APPLE_DARK: Theme = {
  ...APPLE_LIGHT,
  dark: true,
  color: {
    background: "#000000",
    card: "#1C1C1E",
    cardRaised: "#2C2C2E",
    label: "#FFFFFF",
    label2: "#AEAEB2",
    label3: "#8D8D93",
    separator: "#38383A",
    fill: "#2C2C2E",
    accent: "#3D9BFF",
    accentSoft: "#14304F",
    onAccent: "#FFFFFF",
    green: "#30D158",
    orange: "#FF9F0A",
    red: "#FF453A",
    marker: "#FFD166",
    markerSoft: "#3D3418",
    outline: "transparent",
    bubbleMe: "#0A6CD6",
    bubbleCrew: "#2C2C2E",
  },
};

const WORKSHOP_LIGHT: Theme = {
  look: "workshop",
  dark: false,
  color: {
    background: "#FFF6E6",
    card: "#FFFFFF",
    cardRaised: "#FFF9EF",
    label: "#2B2420",
    label2: "#6E615A",
    label3: "#7A6B62",
    separator: "#E9DCC9",
    fill: "#F3E9D6",
    accent: "#C6472D",
    accentSoft: "#FFE1D9",
    onAccent: "#FFFFFF",
    green: "#2F8A58",
    orange: "#B56F00",
    red: "#CF3F2D",
    marker: "#FFD166",
    markerSoft: "#FFF1A8",
    outline: "#2B2420",
    bubbleMe: "#D9ECFF",
    bubbleCrew: "#FFF9EF",
  },
  radius: { card: 16, control: 12, bubble: 18 },
  cardShadow: { x: 3, y: 3 },
  font: { family: "ui-rounded" },
};

const WORKSHOP_DARK: Theme = {
  ...WORKSHOP_LIGHT,
  dark: true,
  color: {
    background: "#241E1A",
    card: "#342C27",
    cardRaised: "#2C2521",
    label: "#FFF3E0",
    label2: "#D9C9B4",
    label3: "#B5A592",
    separator: "#4A3F38",
    fill: "#3B322C",
    accent: "#FF8A6C",
    accentSoft: "#4A2A22",
    onAccent: "#2B2420",
    green: "#5CC98D",
    orange: "#F2B33D",
    red: "#FF7A66",
    marker: "#FFD166",
    markerSoft: "#4A3F1C",
    outline: "#FFF3E0",
    bubbleMe: "#24415F",
    bubbleCrew: "#2C2521",
  },
};

export function themeFor(look: LookId, dark: boolean): Theme {
  if (look === "workshop") return dark ? WORKSHOP_DARK : WORKSHOP_LIGHT;
  return dark ? APPLE_DARK : APPLE_LIGHT;
}

/** The child's look from the Mac ("workshop" unless a grown-up picked another). */
export function lookForChild(look: string | null | undefined): LookId {
  return look === null || look === undefined || look === "workshop" ? "workshop" : "apple";
}

const ThemeContext = createContext<Theme>(APPLE_LIGHT);

export function ThemeProvider(props: { readonly look: LookId; readonly children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => themeFor(props.look, scheme === "dark"), [props.look, scheme]);
  return <ThemeContext value={theme}>{props.children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}

/** iOS text styles (Dynamic Type sizes at the default setting). */
export const TEXT = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400" },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400" },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: "400" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
} as const satisfies Record<string, TextStyle>;
