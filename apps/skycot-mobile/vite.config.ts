import { defineConfig } from "vite-plus";
import "vite-plus/test/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    // The *.integration.test.ts files talk to a real local engine (and relay) when one is named.
    testTimeout: 180_000,
  },
});
