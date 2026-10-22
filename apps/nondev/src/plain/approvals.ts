import type {
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
  ProviderApprovalDecision,
  ProviderApprovalOption,
  ProviderUserInputAnswers,
  RuntimeRequestId,
  TurnItemId,
  UserInputAttachments,
} from "@t3tools/contracts";

import { readPolicyDecision, SKYCOT_POLICY_NOTE } from "@t3tools/skycot-rules/decision";
import { isOutsideProject } from "@t3tools/skycot-rules/files";
import {
  describeMatches,
  evaluateCommand,
  evaluateFileChange,
  evaluateFileRead,
  hardRule,
  isDestructiveCommand,
  readCommandAsk,
  REAL_PROJECT_SENTENCE,
  type RuleEvaluation,
  type RuleMatch,
  SANDBOX_EXPLAINER,
  withLeavesSandbox,
} from "@t3tools/skycot-rules/rules";

import { describeFile, filesFromPrompt, type PromptFile } from "./changes";
import { approvals as copy, buttons, scopes } from "./copy";
import { classifyCommand, type CommandClassification } from "./narration";

// The destructive-command table lives in the shared rules package (one table for the server
// policy and the cards); re-exported so existing callers keep working.
export { isDestructiveCommand };

export type ApprovalScope = keyof typeof scopes;
export type ApprovalRisk = "low" | "medium" | "high" | "blocked";
export type OptionTone = "primary" | "neutral" | "caution" | "danger";

/**
 * The exact payload the UI sends back. Everything except `commandId` / `threadId`, which the
 * caller adds, so the card stays free of transport details.
 */
export type ApprovalDecisionPayload =
  | {
      readonly type: "runtime-request.respond";
      readonly requestId: RuntimeRequestId;
      readonly decision: ProviderApprovalDecision;
    }
  | {
      readonly type: "runtime-request.respond";
      readonly requestId: RuntimeRequestId;
      readonly answers: ProviderUserInputAnswers;
      readonly attachmentsByQuestionId?: UserInputAttachments;
    }
  | { readonly type: "thread.user-input.dismiss"; readonly requestId: RuntimeRequestId }
  | {
      readonly type: "secretRequest.answer";
      readonly turnItemId: TurnItemId;
      readonly answer: { readonly type: "save" } | { readonly type: "decline" };
    }
  | { readonly type: "send-message"; readonly text: string }
  | { readonly type: "run.interrupt" };

export interface ApprovalOption {
  readonly id: string;
  /** Outcome-labelled: "Allow once", never "OK". */
  readonly label: string;
  readonly decision: ApprovalDecisionPayload;
  readonly tone: OptionTone;
  readonly warning?: string;
}

export interface ApprovalCard {
  readonly title: string;
  readonly whatItWants: string;
  readonly whyItMatters: string;
  readonly scope: ApprovalScope;
  readonly scopeExplainer: string;
  readonly sizeOrCost?: string | undefined;
  readonly ifYouSayNo: string;
  readonly risk: ApprovalRisk;
  /**
   * The hard rule(s) that make this a question, in the words Settings uses ("Putting anything
   * live or publishing a package"). Absent when no rule matched.
   */
  readonly ruleTitle?: string | undefined;
  /** Present only when risk is "high" or "blocked": the red line. */
  readonly warning?: string | undefined;
  readonly options: ReadonlyArray<ApprovalOption>;
  readonly nothingPreselected: true;
  /** For the "Show details" disclosure. */
  readonly technical: string;
  /** "question" cards render the question form from this. */
  readonly form?:
    | Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>["questions"]
    | undefined;
  readonly answerByMessage?: boolean | undefined;
}

type ApprovalItem = Extract<OrchestrationV2TurnItem, { type: "approval_request" }>;
type QuestionItem = Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>;
type SecretItem = Extract<OrchestrationV2TurnItem, { type: "secret_request" }>;
type PlanItem = Extract<OrchestrationV2TurnItem, { type: "proposed_plan" }>;

export type RuntimeRequestInput =
  | ApprovalItem
  | QuestionItem
  | SecretItem
  | PlanItem
  | OrchestrationV2RuntimeRequest;

export interface ApprovalContext {
  readonly projectName?: string;
  readonly projectRoot?: string;
  /** The project's own folder when `projectRoot` is the thread's private copy: inside too. */
  readonly projectFolder?: string;
  /** From the matching OrchestrationV2RuntimeRequest when the caller has it. */
  readonly responseCapability?: OrchestrationV2RuntimeRequest["responseCapability"]["type"];
  /** Set when the autonomy level is "fully hands-off"; destructive asks still show. */
  readonly handsOff?: boolean;
  /** The branch everyone sees, when known, so "push to live" can name it. */
  readonly defaultBranch?: string | null;
  /**
   * The branch checked out where the step runs: the thread's own branch (its `skycot/*`
   * private copy) or the folder's. The server judges a bare `git push` with it, so the card
   * must too; null or absent means nobody knows, and the push is a question.
   */
  readonly currentBranch?: string | null;
  /**
   * The command the ask is about, from its own `command_execution` item. Codex shows a reason
   * in the prompt when the step must leave its sandbox, so the prompt alone is not the command.
   */
  readonly toolCallInput?: string;
}

const RISK_ORDER: Record<ApprovalRisk, number> = { low: 0, medium: 1, high: 2, blocked: 3 };

function maxRisk(a: ApprovalRisk, b: ApprovalRisk): ApprovalRisk {
  return RISK_ORDER[b] > RISK_ORDER[a] ? b : a;
}

/** Rules whose match means "this can't be undone" rather than "this leaves the project". */
const IRREVERSIBLE_RULES = new Set([
  "deletes-files",
  "destructive-git",
  "destructive-command",
  "pushes-to-live",
  "publishes-or-deploys",
  "payments",
]);

export type ApprovalDecidedBy = "user" | "policy";

export interface ApprovalDecisionSummary {
  readonly decidedBy: ApprovalDecidedBy;
  /** "You allowed this once" / "Allowed by SKYCOT rules". */
  readonly label: string;
  /** For "Show details": which rules were checked and matched. */
  readonly note?: string;
}

/**
 * Who answered a resolved request and how to say it. The server policy signs its approvals
 * in `answers.skycot`; anything else was a person.
 */
export function describeDecision(
  request: Pick<OrchestrationV2RuntimeRequest, "decision" | "answers" | "status">,
): ApprovalDecisionSummary | null {
  if (request.status === "pending") return null;
  const policy = readPolicyDecision(request.answers);
  if (policy !== null) {
    return {
      decidedBy: "policy",
      label: `Allowed by SKYCOT rules — no hard rule matched`,
      note: SKYCOT_POLICY_NOTE,
    };
  }
  switch (request.decision) {
    case "accept":
      return { decidedBy: "user", label: "You allowed this once" };
    case "acceptForSession":
      return { decidedBy: "user", label: "You allowed this for the rest of the conversation" };
    case "acceptAlways":
      return { decidedBy: "user", label: "You allowed this for the whole project" };
    case "decline":
      return { decidedBy: "user", label: "You said no" };
    case "cancel":
      return { decidedBy: "user", label: "You stopped the assistant" };
    case undefined:
      return null;
  }
}

function respond(
  requestId: RuntimeRequestId,
  decision: ProviderApprovalDecision,
): ApprovalDecisionPayload {
  return { type: "runtime-request.respond", requestId, decision };
}

function toneFor(decision: ProviderApprovalDecision): OptionTone {
  switch (decision) {
    case "accept":
      return "primary";
    case "acceptForSession":
      return "caution";
    case "acceptAlways":
      return "caution";
    case "decline":
      return "neutral";
    case "cancel":
      return "danger";
  }
}

function outcomeLabel(
  decision: ProviderApprovalDecision,
  what: string,
  providerLabel?: string,
): string {
  switch (decision) {
    case "accept":
      return buttons.allowOnce;
    case "acceptForSession":
      return buttons.allowForConversation;
    case "acceptAlways":
      return buttons.allowAlwaysForProject(what);
    case "decline":
      return buttons.dontAllow;
    case "cancel":
      return providerLabel && /stop|interrupt|cancel/i.test(providerLabel)
        ? buttons.stopEverything
        : buttons.stopEverything;
  }
}

const DEFAULT_DECISIONS: ReadonlyArray<ProviderApprovalDecision> = [
  "accept",
  "acceptForSession",
  "acceptAlways",
  "decline",
];

/**
 * Turns the provider's options (or our defaults) into outcome-labelled buttons.
 * High-risk asks lose every sticky "always" option; the user decides each time.
 */
function buildApprovalOptions(
  requestId: RuntimeRequestId,
  risk: ApprovalRisk,
  alwaysWhat: string,
  providerOptions: ReadonlyArray<ProviderApprovalOption> | undefined,
  allowAlways: boolean,
  /** Only "Don't allow" / "Allow once": each ask is a fresh question (reads outside the project). */
  onceOnly = false,
): Array<ApprovalOption> {
  const source: ReadonlyArray<ProviderApprovalOption> =
    providerOptions && providerOptions.length > 0
      ? providerOptions
      : DEFAULT_DECISIONS.map((decision) => ({ decision, label: decision }));
  const seen = new Set<ProviderApprovalDecision>();
  const options: Array<ApprovalOption> = [];
  for (const option of source) {
    if (seen.has(option.decision)) continue;
    if (
      option.decision === "acceptAlways" &&
      (!allowAlways || risk === "high" || risk === "blocked")
    )
      continue;
    if (
      option.decision === "acceptForSession" &&
      (onceOnly || risk === "high" || risk === "blocked")
    )
      continue;
    if (option.decision === "acceptAlways" && onceOnly) continue;
    if (risk === "blocked" && option.decision !== "decline" && option.decision !== "cancel")
      continue;
    seen.add(option.decision);
    options.push({
      id: option.decision,
      label: outcomeLabel(option.decision, alwaysWhat, option.label),
      decision: respond(requestId, option.decision),
      tone: toneFor(option.decision),
      ...(option.warning ? { warning: option.warning } : {}),
    });
  }
  if (!seen.has("decline")) {
    options.push({
      id: "decline",
      label: buttons.dontAllow,
      decision: respond(requestId, "decline"),
      tone: "neutral",
    });
  }
  // Allow first, then softer allows, "no" last — but never visually preselected (nothingPreselected).
  const order: Record<ProviderApprovalDecision, number> = {
    accept: 0,
    acceptForSession: 1,
    acceptAlways: 2,
    decline: 3,
    cancel: 4,
  };
  return options.sort(
    (a, b) => order[a.id as ProviderApprovalDecision] - order[b.id as ProviderApprovalDecision],
  );
}

function firstLine(text: string | undefined, max = 400): string {
  const line =
    text
      ?.split(/\r?\n/)
      .find((l) => l.trim().length > 0)
      ?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** One sentence per idea: a lead that already says "can't be undone" only gets the check line. */
function withUndoWarning(lead: string, check: string = copy.checkTheCommand): string {
  return /can't be undone/i.test(lead)
    ? `${lead} ${check}`
    : `${lead} This can't be undone from inside the app. ${check}`;
}

const READS_OUTSIDE_SCOPE = "Reads one file outside the project; changes nothing.";

/** The real-folder card's title and its one honest warning (rule `changes-real-project`). */
export const REAL_PROJECT_TITLE = "May I change your real project?";
export const REAL_PROJECT_WARNING = `${REAL_PROJECT_SENTENCE} Undo only puts back the private copy this conversation works in.`;

const changesRealProject = (rules: RuleEvaluation) =>
  rules.matches.some((match) => match.rule.id === "changes-real-project");

/**
 * The exact command an approval is about: the `command_execution` item that shares its native
 * item. Undefined when that item is not in the list (yet).
 */
export function toolCallInputFor(
  item: Pick<ApprovalItem, "nativeItemRef">,
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
): string | undefined {
  const ref = item.nativeItemRef;
  if (ref === null || ref.nativeId === null) return undefined;
  const call = turnItems.find(
    (candidate) =>
      candidate.type === "command_execution" &&
      candidate.nativeItemRef?.nativeId === ref.nativeId &&
      candidate.nativeItemRef.driver === ref.driver,
  );
  return call?.type === "command_execution" ? call.input : undefined;
}

/** "Putting anything live or publishing a package", or two such titles joined. */
export function ruleTitleFor(matches: ReadonlyArray<RuleMatch>): string | undefined {
  const titles = [...new Set(matches.map((match) => match.rule.title))];
  if (titles.length === 0) return undefined;
  const shown = titles.slice(0, 2).join(" · ");
  return titles.length > 2 ? `${shown} · and ${titles.length - 2} more` : shown;
}

const SANDBOX_RULE = hardRule("leaves-sandbox");

/**
 * Only a push is judged by branch, so only a push ask needs the folder's branch looked up.
 * Mirrors the server's `needsBranchContext`.
 */
export function approvalNeedsBranch(
  item: OrchestrationV2TurnItem,
  toolCallInput: string | undefined,
): boolean {
  if (item.type !== "approval_request" || item.requestKind !== "command") return false;
  return /\bgit\b[\s\S]*\bpush\b/.test(toolCallInput ?? item.prompt ?? "");
}

function describeCommandApproval(item: ApprovalItem, ctx: ApprovalContext): ApprovalCard {
  const ask = readCommandAsk({
    driver: item.nativeItemRef?.driver,
    prompt: item.prompt,
    toolCallInput: ctx.toolCallInput,
  });
  const command = ask.command ?? (ask.leavesSandbox ? "" : (item.prompt ?? ""));
  const classified: CommandClassification = classifyCommand(command);
  // The same context the server's policy judged with (SkycotPolicyReactor), so the card
  // never paints a hold the engine did not make.
  const inside: RuleEvaluation = evaluateCommand(command, {
    projectRoot: ctx.projectRoot,
    projectFolder: ctx.projectFolder,
    defaultBranch: ctx.defaultBranch,
    currentBranch: ctx.currentBranch,
  });
  const rules = ask.leavesSandbox ? withLeavesSandbox(inside, ask.sandboxReason) : inside;
  const leavesSandbox = ask.leavesSandbox;
  // A match the rules weighed down (a rename, a push to an unknown branch) is a
  // question, not a "can't be undone" warning.
  const irreversible =
    rules.matches.some(
      (match) =>
        IRREVERSIBLE_RULES.has(match.rule.id) &&
        (match.risk === undefined || match.risk === "high"),
    ) || classified.risk === "high";
  const outsideOnly =
    !irreversible && rules.matches.some((match) => match.rule.id === "outside-project");
  const realProject = !irreversible && !outsideOnly && changesRealProject(rules);
  const destructive = irreversible;
  const risk: ApprovalRisk = maxRisk(classified.risk, rules.risk);
  const readsOutside = rules.matches.find((match) => match.rule.id === "reads-outside-project");
  // Only reading outside (no write, delete or upload): it changes nothing, and one allow
  // must not cover the next personal file, so the card offers "Allow once" only.
  const readsOutsideOnly =
    readsOutside !== undefined &&
    !irreversible &&
    !outsideOnly &&
    !leavesSandbox &&
    rules.matches.every(
      (match) => match.rule.id === "reads-outside-project" || match.rule.id === "secrets",
    );
  const doing =
    command.length > 0 ? classified.infinitive : "run a step it could not show in advance";
  const whatItWants = leavesSandbox
    ? `${SANDBOX_EXPLAINER} It wants to ${doing}.`
    : readsOutside
      ? `The assistant wants to read a file outside your project${readsOutside.detail ? ` (${readsOutside.detail})` : ""}.`
      : `The assistant wants to ${classified.infinitive}.`;
  const packages = classified.packages ?? [];
  const sizeOrCost =
    classified.kind === "install"
      ? packages.length > 0
        ? `Downloads ${packages.length === 1 ? "1 add-on" : `${packages.length} add-ons`} from the internet into this project.`
        : "Downloads the add-ons the project already lists. Usually a minute or two."
      : classified.touches === "something live"
        ? "This may cost money or change what customers see."
        : undefined;
  const alwaysWhat =
    classified.kind === "install"
      ? "installs"
      : classified.kind === "test"
        ? "running the project's checks"
        : classified.kind === "git"
          ? "saving versions"
          : classified.kind === "read" || classified.kind === "search"
            ? "looking around the files"
            : `running "${classified.program ?? "this"}"`;
  const allowAlways =
    rules.decision === "allow" &&
    classified.risk === "low" &&
    classified.touches === "only this project";
  // The sandbox line is already the card's opening sentence; say what else matched.
  const otherMatches = rules.matches.filter((match) => match.rule.id !== SANDBOX_RULE.id);
  const ruleLine =
    otherMatches.length > 0 ? `This step ${describeMatches(otherMatches)}.` : undefined;
  return finishCard(
    {
      title: leavesSandbox
        ? "May I step outside the safe area?"
        : destructive
          ? "Careful — this can't be undone"
          : outsideOnly
            ? "May I work outside the project?"
            : realProject
              ? REAL_PROJECT_TITLE
              : readsOutsideOnly
                ? "May I read a file outside the project?"
                : "May I run this?",
      whatItWants,
      whyItMatters:
        ruleLine ??
        (leavesSandbox
          ? "Outside the safe area it can reach the rest of your Mac and the internet, so SKYCOT asks every time."
          : whyCommandMatters(classified)),
      scope: readsOutside || outsideOnly || leavesSandbox ? "your computer" : classified.touches,
      sizeOrCost,
      ifYouSayNo: copy.ifNoCommand,
      risk,
      ruleTitle: ruleTitleFor(rules.matches),
      warning: destructive
        ? withUndoWarning(
            classified.warning ?? "This command deletes, overwrites or publishes something.",
          )
        : outsideOnly
          ? withUndoWarning("This touches files outside the project folder.")
          : realProject
            ? REAL_PROJECT_WARNING
            : undefined,
      options: buildApprovalOptions(
        item.requestId,
        risk,
        alwaysWhat,
        item.options,
        allowAlways,
        readsOutsideOnly || leavesSandbox,
      ),
      technical:
        ask.sandboxReason === undefined
          ? command || (item.prompt ?? "")
          : `${command || "(command not shown yet)"}\n\nThe assistant's reason: ${ask.sandboxReason}`,
    },
    ctx,
    readsOutsideOnly
      ? READS_OUTSIDE_SCOPE
      : leavesSandbox
        ? "Runs outside the assistant's safe area, where it can reach the rest of this Mac."
        : undefined,
  );
}

function whyCommandMatters(classified: CommandClassification): string {
  switch (classified.kind) {
    case "install":
      return "Add-ons are code written by other people. Installing one gives it a place in your project.";
    case "test":
      return "Checks are safe: they only read the project and report back.";
    case "git":
      return classified.touches === "something live"
        ? "This changes what other people see of the project."
        : "This works with the project's saved history on this computer.";
    case "read":
    case "search":
      return "This only reads files. It can't change anything.";
    case "web":
      return classified.touches === "something live"
        ? "This talks to a live service. It may move money or change real records."
        : "This sends or fetches data over the internet.";
    default:
      return classified.touches === "your computer"
        ? "Commands run on the real computer, not in a sandbox. They can change things outside this project."
        : classified.touches === "something live"
          ? "This changes something other people can see or that costs money."
          : "Commands can create, change or delete files inside this project.";
  }
}

interface DescribedPromptFile extends PromptFile {
  readonly noun: string;
  readonly isConfigOrSecret: boolean;
  readonly outside: boolean;
}

function describePromptFiles(
  prompt: string | undefined,
  ctx: ApprovalContext,
): Array<DescribedPromptFile> {
  return filesFromPrompt(prompt).map((file) => {
    const described = describeFile(file.path);
    return {
      ...file,
      noun: described.noun,
      isConfigOrSecret: described.isConfigOrSecret,
      outside: isOutsideProject(file.path, [ctx.projectRoot, ctx.projectFolder]),
    };
  });
}

function joinList(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** "change the booking page" / "create the christmas page" / "change 3 files: …, … (new) and …". */
function fileChangePhrase(files: ReadonlyArray<DescribedPromptFile>): string {
  if (files.length === 0) return "change a file";
  if (files.length === 1) {
    const only = files[0]!;
    const verb =
      only.operation === "add" ? "create" : only.operation === "remove" ? "delete" : "change";
    return `${verb} ${only.noun}`;
  }
  const nouns = files.map((file) =>
    file.operation === "add"
      ? `${file.noun} (new)`
      : file.operation === "remove"
        ? `${file.noun} (deleted)`
        : file.noun,
  );
  return `change ${files.length} files: ${joinList(nouns)}`;
}

function describeFileChangeApproval(item: ApprovalItem, ctx: ApprovalContext): ApprovalCard {
  const files = describePromptFiles(item.prompt, ctx);
  const rules = evaluateFileChange(files, {
    projectRoot: ctx.projectRoot,
    projectFolder: ctx.projectFolder,
  });
  const outside = files.some((file) => file.outside);
  const deletes = files.some((file) => file.operation === "remove");
  const sensitive = files.some((file) => file.isConfigOrSecret);
  const realProject = !outside && changesRealProject(rules);
  // Any delete is a hard rule (QA2-03): red card, once-only buttons.
  const risk: ApprovalRisk = maxRisk(
    deletes || outside ? "high" : sensitive ? "medium" : "low",
    rules.risk,
  );
  const outsideNoun = files.length > 1 ? "At least one of these files is" : "This file is";
  const deleteNoun =
    files.filter((file) => file.operation === "remove").length > 1 ? "These files" : "This file";
  return finishCard(
    {
      title: deletes
        ? "Careful — this deletes a file"
        : realProject
          ? REAL_PROJECT_TITLE
          : files.length > 1
            ? "May I change these files?"
            : "May I change this file?",
      whatItWants: `The assistant wants to ${fileChangePhrase(files)}.`,
      whyItMatters: deletes
        ? "Deleting is a hard rule: it is never done without a fresh question from you."
        : realProject
          ? "This conversation works in a private copy of your project. This change would go into the real folder instead."
          : sensitive
            ? "This touches a settings or secrets file. Mistakes here can break the project or leak keys."
            : "Every change gets a restore point, so you can always go back.",
      scope: outside ? "your computer" : "only this project",
      ifYouSayNo: copy.ifNoFileChange,
      risk,
      ruleTitle: ruleTitleFor(rules.matches),
      warning: deletes
        ? withUndoWarning(`${deleteNoun} will be deleted.`, copy.checkTheFiles)
        : outside
          ? withUndoWarning(`${outsideNoun} outside the project folder.`, copy.checkTheFiles)
          : realProject
            ? REAL_PROJECT_WARNING
            : undefined,
      options: buildApprovalOptions(
        item.requestId,
        risk,
        "file changes",
        item.options,
        rules.decision === "allow" && !sensitive,
      ),
      technical: item.prompt ?? "file change",
    },
    ctx,
  );
}

function describeFileReadApproval(item: ApprovalItem, ctx: ApprovalContext): ApprovalCard {
  const files = describePromptFiles(item.prompt, ctx);
  const outside = files.some((file) => file.outside);
  const secret = files.some(
    (file) => file.isConfigOrSecret && /\.env|secret|credential|\.pem|\.key/i.test(file.path),
  );
  const rules = evaluateFileRead(files, {
    projectRoot: ctx.projectRoot,
    projectFolder: ctx.projectFolder,
  });
  const risk: ApprovalRisk = maxRisk(secret ? "medium" : outside ? "medium" : "low", rules.risk);
  const what =
    files.length === 0
      ? "a file"
      : files.length === 1
        ? files[0]!.noun
        : `${files.length} files: ${joinList(files.map((file) => file.noun))}`;
  return finishCard(
    {
      title: files.length > 1 ? "May I read these files?" : "May I read this file?",
      whatItWants: outside
        ? `The assistant wants to read ${what} — a file outside your project.`
        : `The assistant wants to read ${what}.`,
      whyItMatters: secret
        ? "This file holds secrets. The assistant's service would see them."
        : outside
          ? "This reads a file outside your project. Reading can't change it, but the assistant's service would see its contents."
          : "Reading can't change anything. The assistant just needs to see what's there.",
      scope: outside ? "your computer" : "only this project",
      ifYouSayNo: copy.ifNoFileRead,
      risk,
      ruleTitle: ruleTitleFor(rules.matches),
      options: buildApprovalOptions(
        item.requestId,
        risk,
        "reading files",
        item.options,
        !outside && !secret,
        outside,
      ),
      technical: item.prompt ?? "file read",
    },
    ctx,
    outside
      ? files.length > 1
        ? "Reads files outside the project; changes nothing."
        : READS_OUTSIDE_SCOPE
      : undefined,
  );
}

function describeAppAccessApproval(item: ApprovalItem, ctx: ApprovalContext): ApprovalCard {
  const app = item.appName ?? "a connected app";
  const detail = firstLine(item.prompt);
  const permission = item.requestKind === "permission";
  return finishCard(
    {
      title: permission ? `May I use ${app}?` : `${app} is asking you something`,
      whatItWants: permission
        ? `The assistant wants permission to use ${app}.`
        : detail || `${app} needs an answer before it can continue.`,
      whyItMatters: `${app} can act on your behalf wherever it is signed in.`,
      scope: "the internet",
      ifYouSayNo: copy.ifNoAppAccess,
      risk: "medium",
      ruleTitle: hardRule("connected-app").title,
      options: buildApprovalOptions(item.requestId, "medium", `using ${app}`, item.options, false),
      technical: item.prompt ?? item.requestKind,
    },
    ctx,
  );
}

function describeQuestion(item: QuestionItem, ctx: ApprovalContext): ApprovalCard {
  const count = item.questions.length;
  const first = item.questions[0];
  const byMessage = item.responseMode === "message";
  const options: Array<ApprovalOption> = byMessage
    ? [
        {
          id: "message",
          label: buttons.answer,
          decision: { type: "send-message", text: "" },
          tone: "primary",
        },
      ]
    : [
        {
          id: "answer",
          label: buttons.answer,
          decision: { type: "runtime-request.respond", requestId: item.requestId, answers: {} },
          tone: "primary",
        },
        {
          id: "skip",
          label: buttons.skipQuestion,
          decision: { type: "thread.user-input.dismiss", requestId: item.requestId },
          tone: "neutral",
        },
      ];
  return finishCard(
    {
      title: count === 1 ? "The assistant has a question" : `The assistant has ${count} questions`,
      whatItWants: first ? first.question : "The assistant needs your input.",
      whyItMatters: "Your answer steers what happens next. Nothing changes until you reply.",
      scope: "only this project",
      ifYouSayNo: copy.ifNoQuestion,
      risk: "low",
      options,
      technical: item.questions.map((q) => `${q.header}: ${q.question}`).join("\n"),
      form: item.questions,
      answerByMessage: byMessage,
    },
    ctx,
  );
}

function describeSecretRequest(item: SecretItem, ctx: ApprovalContext): ApprovalCard {
  return finishCard(
    {
      title: `The assistant needs a key: ${item.label}`,
      whatItWants: firstLine(item.reason) || `The assistant needs the ${item.label} to continue.`,
      whyItMatters:
        "The key is stored securely on this computer and handed to the assistant once. It never appears in the chat.",
      scope: "your computer",
      ifYouSayNo: copy.ifNoSecret,
      risk: "medium",
      options: [
        {
          id: "save",
          label: buttons.saveSecret,
          decision: { type: "secretRequest.answer", turnItemId: item.id, answer: { type: "save" } },
          tone: "primary",
        },
        {
          id: "decline",
          label: buttons.declineSecret,
          decision: {
            type: "secretRequest.answer",
            turnItemId: item.id,
            answer: { type: "decline" },
          },
          tone: "neutral",
        },
      ],
      technical: `${item.label}${item.placeholder ? ` (${item.placeholder})` : ""}`,
    },
    ctx,
  );
}

function describePlan(item: PlanItem, ctx: ApprovalContext): ApprovalCard {
  return finishCard(
    {
      title: "Here's the plan",
      whatItWants:
        firstLine(item.markdown, 200) || "The assistant wrote a plan for you to approve.",
      whyItMatters: copy.nothingRuns,
      scope: "only this project",
      ifYouSayNo: copy.ifNoPlan,
      risk: "low",
      options: [
        {
          id: "approve",
          label: buttons.approvePlan,
          decision: { type: "send-message", text: "Looks good — go ahead with the plan." },
          tone: "primary",
        },
        {
          id: "change",
          label: buttons.changePlan,
          decision: { type: "send-message", text: "" },
          tone: "neutral",
        },
        {
          id: "ask",
          label: buttons.askFirst,
          decision: { type: "send-message", text: "" },
          tone: "neutral",
        },
      ],
      technical: item.markdown,
    },
    ctx,
  );
}

function describeRawRequest(
  request: OrchestrationV2RuntimeRequest,
  ctx: ApprovalContext,
): ApprovalCard {
  const capability = request.responseCapability.type;
  switch (request.kind) {
    case "auth_refresh":
      return finishCard(
        {
          title: "The assistant needs you to sign in again",
          whatItWants: "Your sign-in to the assistant's service has expired.",
          whyItMatters: "Nothing can run until the service knows it's you.",
          scope: "the internet",
          ifYouSayNo: "The assistant stays paused until you sign in.",
          risk: "low",
          options: [
            {
              id: "cancel",
              label: buttons.stopEverything,
              decision: respond(request.id, "cancel"),
              tone: "danger",
            },
          ],
          technical: `auth_refresh (${capability})`,
        },
        { ...ctx, responseCapability: capability },
      );
    case "dynamic_tool_call":
      return finishCard(
        {
          title: "May I use this tool?",
          whatItWants: "The assistant wants to use one of its tools.",
          whyItMatters:
            "Tools can read, change or send things depending on what they are. Check the details.",
          scope: "your computer",
          ifYouSayNo: copy.ifNoCommand,
          risk: "medium",
          options: buildApprovalOptions(request.id, "medium", "this tool", undefined, false),
          technical: `dynamic_tool_call (${capability})`,
        },
        { ...ctx, responseCapability: capability },
      );
    case "user_input":
      return finishCard(
        {
          title: "The assistant has a question",
          whatItWants: "The assistant needs your input.",
          whyItMatters: "Your answer steers what happens next.",
          scope: "only this project",
          ifYouSayNo: copy.ifNoQuestion,
          risk: "low",
          options: [
            {
              id: "skip",
              label: buttons.skipQuestion,
              decision: { type: "thread.user-input.dismiss", requestId: request.id },
              tone: "neutral",
            },
          ],
          technical: `user_input (${capability})`,
          answerByMessage: capability === "message",
        },
        { ...ctx, responseCapability: capability },
      );
    case "command":
    case "file-change":
    case "file-read":
    case "mcp-elicitation":
    case "permission": {
      const stub: ApprovalItem = {
        type: "approval_request",
        id: "" as TurnItemId,
        threadId: "" as never,
        runId: null,
        nodeId: request.nodeId,
        providerThreadId: null,
        providerTurnId: request.providerTurnId,
        nativeItemRef: request.nativeRequestRef,
        parentItemId: null,
        ordinal: 0,
        status: request.status === "pending" ? "waiting" : "completed",
        title: null,
        startedAt: null,
        completedAt: null,
        updatedAt: request.createdAt,
        requestId: request.id,
        requestKind: request.kind,
      };
      return describeRuntimeRequest(stub, { ...ctx, responseCapability: capability });
    }
  }
}

function finishCard(
  card: Omit<ApprovalCard, "nothingPreselected" | "scopeExplainer">,
  ctx: ApprovalContext,
  /** Replaces the scope's generic sentence when the card knows better. */
  scopeExplainer?: string,
): ApprovalCard {
  const gone = ctx.responseCapability === "not_resumable";
  const options: ReadonlyArray<ApprovalOption> = gone
    ? [
        {
          id: "interrupt",
          label: buttons.stopEverything,
          decision: { type: "run.interrupt" },
          tone: "danger",
        },
      ]
    : card.options;
  const warning = gone ? copy.providerGone : card.warning;
  const hasAlways = options.some((o) => o.id === "acceptAlways");
  const whyItMatters =
    card.risk === "high" && !hasAlways
      ? `${card.whyItMatters} ${copy.neverAlwaysAllow}`
      : card.whyItMatters;
  return {
    ...card,
    whyItMatters,
    scopeExplainer: scopeExplainer ?? scopes[card.scope],
    ...(warning ? { warning } : {}),
    options,
    nothingPreselected: true,
  };
}

/**
 * Builds the "May I…?" card for any runtime request the contracts define. Pass the turn item
 * when you have it (richer: prompt, app name, provider options); the bare runtime request
 * works too and degrades to a generic card.
 */
export function describeRuntimeRequest(
  request: RuntimeRequestInput,
  ctx: ApprovalContext = {},
): ApprovalCard {
  if (!("type" in request)) return describeRawRequest(request, ctx);
  switch (request.type) {
    case "approval_request":
      switch (request.requestKind) {
        case "command":
          return describeCommandApproval(request, ctx);
        case "file-change":
          return describeFileChangeApproval(request, ctx);
        case "file-read":
          return describeFileReadApproval(request, ctx);
        case "mcp-elicitation":
        case "permission":
          return describeAppAccessApproval(request, ctx);
      }
      break;
    case "user_input_request":
      return describeQuestion(request, ctx);
    case "secret_request":
      return describeSecretRequest(request, ctx);
    case "proposed_plan":
      return describePlan(request, ctx);
  }
  // A requestKind from a newer server: ask, never auto-allow.
  const fallback = request as ApprovalItem;
  return finishCard(
    {
      title: "May I do this?",
      whatItWants:
        firstLine(fallback.prompt) || "The assistant wants to do something it needs your OK for.",
      whyItMatters: "This kind of request is new to this app, so it always asks.",
      scope: "your computer",
      ifYouSayNo: copy.ifNoCommand,
      risk: "medium",
      options: buildApprovalOptions(fallback.requestId, "medium", "this", fallback.options, false),
      technical: fallback.prompt ?? String(fallback.requestKind),
    },
    ctx,
  );
}
