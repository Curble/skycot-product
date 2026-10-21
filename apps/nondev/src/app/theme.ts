// Keeps `html.dark` in step with the system appearance and the stock UI's
// theme keys after first paint (index.html handles first paint itself). An
// explicit stored choice wins; otherwise the OS setting does.
const THEME_KEY = "t3code:theme";
const APPEARANCE_MODE_KEY = "t3code:theme-appearance-mode";

export function resolveIsDark(prefersDark: boolean): boolean {
  let stored: string | null = null;
  let mode: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
    mode = window.localStorage.getItem(APPEARANCE_MODE_KEY);
  } catch {
    // Storage blocked: follow the system.
  }
  if (stored === "dark" || mode === "dark") return true;
  if (stored === "light" || mode === "light") return false;
  return prefersDark;
}

export function applyTheme(isDark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  // Match the window token so the gap before paint never flashes white/black.
  root.style.backgroundColor = isDark ? "#1e1e1e" : "#f5f5f7";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = isDark ? "#262628" : "#f6f6f8";
}

export function startThemeSync(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => applyTheme(resolveIsDark(media.matches));
  update();
  media.addEventListener("change", update);
  window.addEventListener("storage", update);
  return () => {
    media.removeEventListener("change", update);
    window.removeEventListener("storage", update);
  };
}
