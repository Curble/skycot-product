import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";

// The brand sweep (24 October 2026): every name a person, a child or an AI provider sees reads
// T3CODE_APP_BASE_NAME, which nondev/brand/env.cjs sets to "SKYCOT". The upstream tests run with
// it unset and still see "T3 Code"; these load the same modules with it set.
async function withBrand<T>(load: () => Promise<T>): Promise<T> {
  vi.stubEnv("T3CODE_APP_BASE_NAME", "SKYCOT");
  vi.resetModules();
  return load();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("brand sweep: SKYCOT everywhere a person or a provider reads the app's name", () => {
  it("the assistant is told it runs in SKYCOT", async () => {
    const runtime = await withBrand(
      () => import("@t3tools/provider-core/server/runtimeInstructions"),
    );
    const orchestration = await import("@t3tools/provider-core/server/orchestrationInstructions");
    const text = runtime.buildRuntimeInstructions({ harness: "codex" });
    assert.include(text, "you are running in SKYCOT through the codex harness");
    assert.include(
      orchestration.T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
      "You are running inside SKYCOT.",
    );
    for (const value of [text, orchestration.T3_CODE_ORCHESTRATION_INSTRUCTIONS])
      assert.notInclude(value, "T3 Code");
  });

  it("an agent's MCP sign-in names SKYCOT", async () => {
    const oauth = await withBrand(() => import("../auth/McpOAuth.ts"));
    const metadata = oauth.protectedResourceMetadata({
      issuer: "http://127.0.0.1:3773",
      resource: "http://127.0.0.1:3773/mcp",
    });
    assert.strictEqual(metadata.resource_name, "SKYCOT");
  });

  it("provider version notes name SKYCOT", async () => {
    const { resolveProviderCompatibility } = await withBrand(
      () => import("../provider/providerCompatibility.ts"),
    );
    const { ProviderDriverKind } = await import("@t3tools/contracts");
    const driver = ProviderDriverKind.make("codex");
    const advisory = resolveProviderCompatibility(
      [{ driver, t3CodeRange: ">=0.0.0", ranges: [{ range: "<1.0.0", status: "broken" }] }],
      driver,
      "0.9.0",
    );
    assert.strictEqual(
      advisory?.message,
      "This provider version is known to be incompatible with this SKYCOT release.",
    );
  });
});
