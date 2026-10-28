// Pre-commit secret scan. Fail-open: if gitleaks is not installed, warn and allow the commit.
// vp staged appends the staged file names as arguments; we ignore them and scan the staged diff.
import { spawnSync } from "node:child_process";

const probe = spawnSync("gitleaks", ["version"], { stdio: "ignore" });
if (probe.error || probe.status !== 0) {
  console.warn("gitleaks not found - skipping secret scan (install with: brew install gitleaks)");
  process.exit(0);
}

const result = spawnSync(
  "gitleaks",
  ["git", ".", "--pre-commit", "--staged", "--redact", "--no-banner", "--config", ".gitleaks.toml"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
