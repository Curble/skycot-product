import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// nondev-seam: brand-advanced-web-test. Advanced mode in a SKYCOT build: the web build defines
// T3CODE_APP_BASE_NAME / T3CODE_CLI_NAME (vite.config.ts, from nondev/brand/env.cjs), so every
// screen names SKYCOT and suggests `skycot …`. Upstream's tests run with them unset ("T3 Code").
const loadBranded = async <T>(load: () => Promise<T>): Promise<T> => {
  vi.stubEnv("T3CODE_APP_BASE_NAME", "SKYCOT");
  vi.stubEnv("T3CODE_CLI_NAME", "skycot");
  vi.resetModules();
  return load();
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Advanced mode in a SKYCOT build", () => {
  it("one name for the product and one for the command", async () => {
    const branding = await loadBranded(() => import("./branding"));
    expect(branding.APP_BASE_NAME).toBe("SKYCOT");
    expect(branding.CLI_COMMAND_NAME).toBe("skycot");
    expect(branding.CLI_RUN_COMMAND).toBe("skycot");
  });

  it("screens, connection labels and shared messages name SKYCOT", async () => {
    const update = await loadBranded(() => import("./components/desktopUpdate.logic"));
    const metadata = await import("./connection/clientMetadata");
    const promptLinks = await import("@t3tools/shared/promptLinks");
    const contracts = await import("@t3tools/contracts");
    const sharedName = await import("@t3tools/shared/appName");
    expect(sharedName.APP_NAME).toBe("SKYCOT");

    expect(
      update.getDesktopUpdateInstallConfirmationMessage({
        availableVersion: "1.2.3",
        downloadedVersion: null,
      }),
    ).toContain("restart SKYCOT?");
    const desktop = metadata.clientPresentationMetadata({
      appVersion: "0.0.0",
      hosted: false,
      identity: { userAgent: "", platform: "MacIntel", maxTouchPoints: 0 } as never,
      desktopBridge: {},
    });
    expect(desktop.label).toBe("SKYCOT Desktop");
    const link = promptLinks.parseNewThreadLink(`?pr=${encodeURIComponent("not a pr")}`);
    expect(link).toEqual({
      ok: false,
      error: "This link names a pull request SKYCOT cannot read.",
    });
    expect(contracts.BROWSER_IMPORT_FAILURE_COPY.needsFullDiskAccess).toContain(
      "Give SKYCOT Full Disk Access",
    );
  });

  it("upstream is unchanged", async () => {
    vi.resetModules();
    const branding = await import("./branding");
    expect(branding.APP_BASE_NAME).toBe("T3 Code");
    expect(branding.CLI_COMMAND_NAME).toBe("t3");
    expect(branding.CLI_RUN_COMMAND).toBe("npx t3");
  });
});
