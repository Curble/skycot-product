// Every user-facing string the plain-language layer emits lives here so a later
// i18n pass can swap the table without touching the mapping logic. Rules for
// additions: name the outcome on buttons (never "Are you sure?"), never use
// "invalid", "failed", "error <code>" or raw developer nouns, and when an
// outside service is at fault, name it ("GitHub didn't respond").

export const buttons = {
  allowOnce: "Allow once",
  allowForConversation: "Allow for the rest of this conversation",
  allowAlwaysForProject: (what: string) => `Always allow ${what} for this project`,
  dontAllow: "Don't allow — find another way",
  stopEverything: "Stop the assistant",
  answer: "Send my answer",
  skipQuestion: "Skip — carry on with your best guess",
  saveSecret: "Save it securely",
  declineSecret: "Don't share it",
  approvePlan: "Looks good — go ahead",
  changePlan: "Change the plan",
  askFirst: "Ask me something first",
  keepThisVersion: "Keep this version",
  sendForReview: "Send for review",
  putItLive: "Put it live",
  restore: "Restore this version",
  keepCurrent: "Keep what I have",
  showCode: "Show code",
  showDetails: "Show details",
  tryToFix: "Try to fix it for me",
} as const;

export const autonomy = {
  askMeFirst: {
    label: "Ask me first",
    description: "The assistant asks before every command and every file change.",
    hint: "Recommended. Slowest, safest.",
  },
  justDoItCarefully: {
    label: "Just do it, carefully",
    description:
      "File changes happen without asking. Running things, installing add-ons and anything that leaves this project still needs your OK.",
    hint: "A good middle ground once you trust the task.",
  },
  fullyHandsOff: {
    label: "Fully hands-off",
    description:
      "Nothing is checked with you. The assistant can run any command on this computer, install anything and change any file.",
    hint: "Only for tasks you completely trust. Switches itself off after the time you choose.",
    warning:
      "Hands-off mode can delete files, spend money or send things to the internet without asking. Keep a restore point and a short timer.",
  },
  fallback: (wanted: string, got: string, provider: string) =>
    `${provider} doesn't offer "${wanted}", so this conversation runs as "${got}" instead. That means more questions, never fewer.`,
  autoModeNote:
    "This assistant has its own built-in reviewer that waves through routine steps and asks you about the risky ones.",
} as const;

export const care = {
  careful: {
    label: "Careful",
    description: "Thinks longer before acting. Slower, fewer mistakes.",
  },
  balanced: { label: "Balanced", description: "The usual setting." },
  quick: { label: "Quick", description: "Faster and cheaper, but may miss things." },
  speedNormal: { label: "Normal speed", description: "Standard replies at the standard price." },
  speedFast: { label: "Faster", description: "Quicker replies at a higher price per request." },
  speedFastest: {
    label: "Fastest (premium)",
    description: "The quickest replies, at the highest price per request.",
  },
} as const;

export const scopes = {
  "only this project": "Touches only files inside this project.",
  "your computer": "Can affect files or programs outside this project, on this computer.",
  "the internet": "Sends or fetches something over the internet.",
  "something live": "Changes something other people can see or that costs money.",
} as const;

export const approvals = {
  nothingRuns: "Nothing happens until you choose.",
  ifNoCommand:
    "Nothing runs. I'll tell the assistant you said no and it will look for another way or ask you.",
  ifNoFileChange: "The file stays as it is. The assistant will suggest a different approach.",
  ifNoFileRead: "The assistant won't see that file and may have to guess.",
  ifNoAppAccess: "The connected app stays untouched. The assistant will try without it.",
  ifNoQuestion: "The assistant carries on with its best guess.",
  ifNoSecret: "The assistant can't use that service until you provide the key.",
  ifNoPlan: "Nothing changes. Tell the assistant what you'd like different.",
  destructiveWarning:
    "This can't be undone from inside the app. Check the exact command below before allowing it.",
  neverAlwaysAllow:
    "There is no 'always allow' for actions like this one — each time is a fresh question.",
  providerGone: "The assistant's process has gone away. Stop or restart the run to answer this.",
  readOnlyAnswer: "You can answer this by typing a message instead.",
} as const;

export const versions = {
  restorePoint: "Restore point",
  keptVersion: "Kept version",
  live: "Live",
  restoreDoes: [
    "Puts every file in this project back to how it was at this point.",
    "Adds a new restore point first, so you can undo the restore itself.",
    "Keeps the whole conversation — later messages stay in the chat so you can re-apply them.",
  ],
  restoreDoesNot: [
    "Doesn't touch anything already sent for review or put live.",
    "Doesn't change data in a database or account — only the project's files.",
    "Doesn't delete the versions after this one; they stay in the list.",
  ],
  cannotRestoreMissing: "This restore point is no longer on disk, so it can't be restored.",
  cannotRestoreStale: "Files changed outside the app since this point, so restoring it isn't safe.",
  cannotRestoreShared:
    "This project folder is shared with other work, so files can't be rolled back here.",
  youWillLose: (when: string) => `You'll lose changes made after ${when}. They stay in the chat.`,
} as const;

export const git = {
  keepThisVersion: {
    label: "Keep this version",
    explainer:
      "Saves a named snapshot into the project's history. Only on this computer; nothing goes online.",
    advanced: "Advanced: git commit",
  },
  sendForReview: {
    label: "Send for review",
    explainer:
      "Uploads your saved versions to a separate draft line online and opens a review request. Nothing goes live until a reviewer combines it.",
    advanced: "Advanced: git push to a feature branch, then open a pull request",
  },
  updateReview: {
    label: "Update the review",
    explainer: "Uploads your newest saved version to the review that is already open.",
    advanced: "Advanced: git push to the existing pull-request branch",
  },
  putItLive: {
    label: "Put it live",
    explainer: "Combines the approved review into the live version everyone sees.",
    advanced: "Advanced: merge the pull request into the default branch",
  },
  onLiveVersionGuard: (branch: string) =>
    `You're working on the live version (${branch}). I'll move these changes onto a separate draft line first so nothing goes live by accident.`,
  neverPushLive:
    "This app never uploads straight to the live version. Reviews are the only way live.",
  noRemote:
    "This project isn't connected to an online copy yet, so there's nowhere to send a review.",
  nothingToKeep: "No changes to keep — everything is already saved.",
  prStates: {
    draftOpen: "Draft — not sent to reviewers yet",
    waitingForReview: "Waiting for a reviewer",
    approved: "Approved — ready to put live",
    changesRequested: "A reviewer asked for changes",
    checksFailing: "The automatic checks found problems",
    checksRunning: "Automatic checks are still running",
    conflicting: "Clashes with newer changes — needs untangling first",
    merged: "Live",
    closed: "Closed without going live",
  },
  blockers: {
    noReview: "There's no review open yet. Send for review first.",
    notApproved: "A reviewer hasn't approved it yet.",
    checksFailing: "The automatic checks found problems.",
    checksPending: "The automatic checks haven't finished.",
    conflicting: "It clashes with newer changes and needs untangling first.",
    alreadyLive: "This is already live.",
    closed: "This review was closed, so it can't go live.",
  },
} as const;

export const errors = {
  didNotRespond: (service: string, retryInSeconds?: number) =>
    retryInSeconds === undefined
      ? `${service} didn't respond.`
      : `${service} didn't respond. Trying again in ${retryInSeconds} s.`,
  usageLimit: (resetAt?: string) =>
    resetAt === undefined
      ? "You've used up this assistant's allowance for now."
      : `You've used up this assistant's allowance for now. It resets at ${resetAt}.`,
  permission:
    "The assistant wasn't allowed to do that. You can allow it below or ask for another way.",
  somethingWentWrong: (what: string) =>
    `${what} didn't work. The details are below if you want them.`,
  partialSuccess: (done: number, total: number, what: string) =>
    `${done} of ${total} ${what} done. The rest needs your decision.`,
  stoppedByYou: "Stopped — you asked the assistant to stop.",
} as const;

export const progress = {
  gettingReady: "Getting ready…",
  working: "Working on it…",
  waitingForYou: "Waiting for you — there's a question below.",
  waitingForApproval: "Waiting for your go-ahead below.",
  allDone: "All done.",
  stopped: "Stopped.",
  restored: "Restored to an earlier version.",
  somethingWentWrong: "Something went wrong — details below.",
  nothingYet: "Nothing has happened yet.",
} as const;

export const changes = {
  untouched: "Everything else in the project is untouched.",
  nothingChanged: "Nothing changed.",
  areas: {
    pages: "Pages",
    styles: "Look and feel",
    content: "Words and images",
    settings: "Settings",
    "behind the scenes": "Behind the scenes",
  },
  flags: {
    filesDeleted: (count: number) => `${count} ${count === 1 ? "file was" : "files were"} deleted.`,
    configOrSecretsTouched: "Settings or secret files were changed — worth a second look.",
    dependenciesChanged: "The project's list of required add-ons changed.",
  },
} as const;
