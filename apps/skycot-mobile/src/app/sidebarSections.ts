// nondev-seam: skycot-ipad-sections
import type { ShellSection } from "./Shell";

export const CHILD_SIDEBAR_SECTIONS: ReadonlyArray<ShellSection> = [
  { id: "make", title: "Make", symbol: "sparkles", route: "ChildHome" },
  { id: "my-makes", title: "My makes", symbol: "bubble.left", route: "MyMakes" },
  {
    id: "fridge",
    title: "Fridge",
    symbol: "refrigerator",
    selectedSymbol: "refrigerator.fill",
    route: "Fridge",
  },
  {
    id: "stickers",
    title: "Stickers",
    symbol: "star",
    selectedSymbol: "star.fill",
    route: "Stickers",
  },
];

export function grownupSidebarSections(requestCount: number): ReadonlyArray<ShellSection> {
  return [
    {
      id: "requests",
      title: "Requests",
      symbol: "hand.raised",
      selectedSymbol: "hand.raised.fill",
      route: "Requests",
      ...(requestCount > 0 ? { badge: String(requestCount) } : {}),
    },
    {
      id: "children",
      title: "Children",
      symbol: "figure.2.and.child.holdinghands",
      route: "Children",
    },
    { id: "recap", title: "Recap", symbol: "chart.bar", route: "RecapHome" },
    { id: "device", title: "This device", symbol: "iphone", route: "ThisDevice" },
    { id: "macs", title: "Linked Macs", symbol: "desktopcomputer", route: "Macs" },
  ];
}
