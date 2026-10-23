/** The letter pictures' colours, light and dark (no images here, so plain tests can read them). */
export const AVATAR_COLORS: Readonly<
  Record<string, { readonly light: string; readonly dark: string }>
> = {
  sky: { light: "#2f7de1", dark: "#3f8ef0" },
  sun: { light: "#d98a00", dark: "#e09a1a" },
  leaf: { light: "#2f9e57", dark: "#36ad62" },
  berry: { light: "#c2366b", dark: "#d84a80" },
  grape: { light: "#7a4fd0", dark: "#8e66e0" },
  coral: { light: "#e0603f", dark: "#ec7252" },
};
