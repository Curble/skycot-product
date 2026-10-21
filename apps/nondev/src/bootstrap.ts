// Same shape as apps/web/src/bootstrap.ts: load the app after the React refresh
// preamble and surface boot failures before React mounts.
void import("./main")
  .then(({ startup }) => startup)
  .catch((error: unknown) => {
    const root = document.getElementById("root");
    if (root) {
      root.textContent = `T3 Code Simple could not start: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
