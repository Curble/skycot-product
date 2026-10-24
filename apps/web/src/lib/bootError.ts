// nondev-seam: brand-advanced-boot-error (no imports here: it must run when the app cannot load)
const APP_NAME = import.meta.env.T3CODE_APP_BASE_NAME || "T3 Code";

export function showBootError(error: unknown) {
  console.error(`${APP_NAME} failed to start.`, error);
  const bootShell = document.getElementById("boot-shell");
  if (!bootShell) return;

  const content = document.createElement("div");
  content.id = "boot-error";
  content.setAttribute("role", "alert");

  const message = document.createElement("p");
  message.textContent = `${APP_NAME} could not load.`;
  content.append(message);

  if (import.meta.env.DEV && error instanceof Error) {
    const detail = document.createElement("p");
    detail.textContent = error.message;
    content.append(detail);
  }

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  content.append(reload);
  bootShell.replaceChildren(content);
}
