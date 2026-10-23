#!/usr/bin/env node
// A stand-in for the `claude` command for SKYCOT's end-to-end relay test: no AI, no network, no
// account. It speaks just enough of Claude Code's stream-json protocol (the one the Agent SDK
// drives) for one scripted turn: it asks permission to run one command ("Add a game library"),
// waits for the answer the engine relays from a grown-up, and finishes. Every line it receives
// is appended to $FAKE_CLAUDE_LOG when set.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write("2.1.300 (Claude Code)\n");
  process.exit(0);
}

const logFile = process.env.FAKE_CLAUDE_LOG;
const log = (line) => {
  if (logFile) NodeFS.appendFileSync(logFile, `${line}\n`);
};
log(`# start ${JSON.stringify(args)}`);

const sessionIndex = args.indexOf("--session-id");
const resumeIndex = args.indexOf("--resume");
const sessionId =
  (sessionIndex >= 0 && args[sessionIndex + 1]) ||
  (resumeIndex >= 0 && args[resumeIndex + 1]) ||
  NodeCrypto.randomUUID();
const modelIndex = args.indexOf("--model");
const model = (modelIndex >= 0 && args[modelIndex + 1]) || "claude-sonnet-4-5";
const cwd = process.cwd();

const send = (message) => {
  log(`> ${JSON.stringify(message)}`);
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
const uuid = () => NodeCrypto.randomUUID();
const usage = {
  input_tokens: 10,
  output_tokens: 10,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

let initSent = false;
let turn = null;

function init() {
  if (initSent) return;
  initSent = true;
  send({
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "2.1.300",
    cwd,
    tools: ["Bash", "Read", "Write", "Edit"],
    mcp_servers: [],
    model,
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    agents: [],
    uuid: uuid(),
    session_id: sessionId,
  });
}

function assistant(content, stopReason) {
  send({
    type: "assistant",
    message: {
      id: `msg_${uuid().slice(0, 8)}`,
      type: "message",
      role: "assistant",
      model,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: uuid(),
  });
}

function finish(text) {
  assistant([{ type: "text", text }], "end_turn");
  send({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    duration_api_ms: 5,
    num_turns: 1,
    result: text,
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage,
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
    uuid: uuid(),
  });
  turn = null;
}

function startTurn() {
  init();
  const toolUseId = `toolu_${uuid().replaceAll("-", "").slice(0, 20)}`;
  const input = { command: "npm install phaser", description: "Add a game library" };
  assistant(
    [
      { type: "text", text: "To make the game move, I need a game library." },
      { type: "tool_use", id: toolUseId, name: "Bash", input },
    ],
    "tool_use",
  );
  const requestId = `perm_${uuid().slice(0, 8)}`;
  turn = { requestId, toolUseId };
  send({
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input,
      permission_suggestions: [],
      tool_use_id: toolUseId,
      description: "Add a game library",
    },
  });
}

function answerControl(message) {
  const request = message.request ?? {};
  const reply = (response) =>
    send({
      type: "control_response",
      response: { subtype: "success", request_id: message.request_id, response },
    });
  switch (request.subtype) {
    case "initialize":
      return reply({
        commands: [],
        agents: [],
        output_style: "default",
        available_output_styles: ["default"],
        models: [
          { value: model, displayName: "Claude (pretend)", description: "No AI: a test stand-in." },
        ],
        account: {
          email: "pretend@skycot.invalid",
          organization: "SKYCOT test",
          subscriptionType: "max",
          tokenSource: "claude.ai",
          apiProvider: "firstParty",
        },
      });
    case "mcp_status":
      return reply({ mcpServers: [] });
    case "interrupt":
      reply({});
      if (turn !== null) finish("Stopped.");
      return;
    default:
      return reply({});
  }
}

const lines = NodeReadline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  log(`< ${line}`);
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type === "control_request") return answerControl(message);
  if (message.type === "control_response") {
    const response = message.response ?? {};
    if (turn === null || response.request_id !== turn.requestId) return;
    const decision = response.response ?? {};
    if (decision.behavior === "allow") {
      send({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: turn.toolUseId,
              content: "added 1 package",
              is_error: false,
            },
          ],
        },
        parent_tool_use_id: null,
        session_id: sessionId,
        uuid: uuid(),
      });
      finish("Done: the game library is added.");
    } else {
      finish("Okay, I won't add it.");
    }
    return;
  }
  if (message.type === "user") {
    init();
    if (turn === null) startTurn();
  }
});
lines.on("close", () => process.exit(0));
