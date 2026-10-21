import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  classifyWorkflows,
  hasRepositoryGuard,
  renderWorkflowCheck,
  riskyTriggers,
} from "./check-workflows.ts";

const guarded = `name: release
on:
  push:
    tags: ["v*"]
jobs:
  build:
    if: github.repository == 'pingdotgg/t3code'
    runs-on: ubuntu-latest
`;
const ownerGuarded = `jobs:\n  x:\n    if: ${"${{"} github.repository_owner == 'pingdotgg' }}\n`;
const unguarded = `name: pr-size
on:
  pull_request_target:
    types: [opened]
jobs:
  size:
    runs-on: ubuntu-latest
`;
const plain = `name: ci\non:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n`;

NodeTest.describe("check-workflows", () => {
  NodeTest.it("detects repository guards in any comparison form", () => {
    NodeAssert.ok(hasRepositoryGuard(guarded));
    NodeAssert.ok(hasRepositoryGuard(ownerGuarded));
    NodeAssert.ok(hasRepositoryGuard(`if: github.repository != 'pingdotgg/t3code'`));
    NodeAssert.ok(!hasRepositoryGuard(unguarded));
    NodeAssert.ok(!hasRepositoryGuard("# mentions github.repository in a comment only"));
  });

  NodeTest.it("names the triggers that mix a privileged token with outside input", () => {
    NodeAssert.deepEqual(riskyTriggers(unguarded), ["pull_request_target"]);
    NodeAssert.deepEqual(riskyTriggers("on:\n  workflow_run:\n    workflows: [ci]\n"), [
      "workflow_run",
    ]);
    NodeAssert.deepEqual(riskyTriggers(plain), []);
    NodeAssert.deepEqual(riskyTriggers("# workflow_run: in a comment\n"), []);
  });

  NodeTest.it("classifies ours, guarded, allow-listed and unguarded workflows", () => {
    const checks = classifyWorkflows(
      [
        { name: "release.yml", text: guarded },
        { name: "pr-size.yml", text: unguarded },
        { name: "ci.yml", text: plain },
        { name: "nondev-ci.yml", text: plain },
        { name: "windows-tests.yml", text: plain },
      ],
      ["ci.yml", "windows-tests.yml"],
    );
    NodeAssert.deepEqual(
      checks.map((c) => [c.name, c.kind]),
      [
        ["ci.yml", "allowlisted"],
        ["nondev-ci.yml", "ours"],
        ["pr-size.yml", "unguarded"],
        ["release.yml", "guarded"],
        ["windows-tests.yml", "allowlisted"],
      ],
    );
    const report = renderWorkflowCheck(checks, false);
    NodeAssert.ok(report.includes("`pr-size.yml` — uses `pull_request_target`"));
    NodeAssert.ok(report.includes("Result: WARN"));
    NodeAssert.ok(renderWorkflowCheck(checks, true).includes("Result: FAIL"));
    NodeAssert.ok(
      renderWorkflowCheck(
        checks.filter((c) => c.kind !== "unguarded"),
        true,
      ).includes("Result: OK"),
    );
  });
});
