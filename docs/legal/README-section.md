# README section draft

Paste the block below at the top of the fork's `README.md` (replacing upstream's title block) when
the repository is made public, or keep it below upstream's text if the README is left as-is.

---

# SKYCOT

SKYCOT is a plain-language interface for running coding agents (Claude Code, Codex, Cursor, Grok,
OpenCode, Antigravity) on your own Mac, built for business owners rather than developers.
Website: https://www.skycot.com

## Based on T3 Code

SKYCOT is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc., used under
the [MIT License](./LICENSE). The engine, the provider connectors and the full developer interface
("Advanced mode") are T3 Code's work; SKYCOT adds the `apps/nondev` client and the `nondev/`
branding layer, and keeps every other change to upstream to the handful of one-line seams listed in
[`SEAM-MANIFEST.md`](./SEAM-MANIFEST.md).

- Upstream copyright and licence are preserved in [`LICENSE`](./LICENSE) and
  [`NOTICE`](./NOTICE).
- Third-party open-source notices are generated at build time
  (`third-party-licenses.config.json`) and shown in the app under Settings › About.
- "T3" and "T3 Code" are names of T3 Tools Inc. SKYCOT is an independent product and is **not
  affiliated with or endorsed by** T3 Tools Inc. Please report SKYCOT issues here, not to T3.

## Licence

The T3 Code portions are © T3 Tools Inc., MIT License. SKYCOT's additions are © 2026 SKYCOT and
released under the same MIT License (see [`LICENSE`](./LICENSE)).

<!-- If Mark decides to keep SKYCOT's additions proprietary, replace the last sentence with:
"SKYCOT's additions (apps/nondev, nondev/) are © 2026 SKYCOT Pty Ltd, all rights reserved; see
LICENSE-SKYCOT." and add that file. The T3 Code portions remain MIT either way. -->

---

Notes for the editor:

- Upstream's install instructions (`curl https://t3.codes/install.sh`, `brew install --cask
t3-code`, `winget install T3Tools.T3Code`, `npx t3`) install **T3 Code**, not SKYCOT. Remove them
  from SKYCOT's README or they will send customers to T3's binaries.
- Keep the "Contributing" and "AGENTS.md" pointers if the repository stays public; they are
  upstream's and still accurate for the shared code.
