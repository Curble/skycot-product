import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { deleteConversationApprovalId } from "@t3tools/skycot-rules/family";

import { useAtomCommand } from "~/state/use-atom-command";

import { HOME_HREF, navigate, parseRoute, threadHref } from "../../router";
import { refreshOldConversations } from "../../state/oldConversations";
import { threadEnvironment } from "../../state/threads";
import { showToast } from "../../ui/Toast";
import { isFamilyRefusal } from "../family/cards";
import { useFamily } from "../family/FamilyProvider";
import { refreshFridge } from "../fridge/store";
import { forgetRename, rememberRename } from "./renamedTitles";
import { pinToastMessage } from "./pinned";
import { cleanTitle, quotedName } from "./tidy";

export type TidyOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** A delete either happened, was called off at the parent-code sheet, or did not go through. */
export type DeleteOutcome =
  | { readonly kind: "deleted" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

const NEEDS_GROWN_UP = "A grown-up needs to enter the parent code first. Nothing was deleted.";

const DIDNT_GO = "That didn't go through. Check your Mac is awake and try again.";

function isOpen(shell: Pick<EnvironmentThreadShell, "environmentId" | "id">): boolean {
  const route = parseRoute(window.location.hash);
  return (
    route.name === "thread" &&
    route.environmentId === shell.environmentId &&
    route.threadId === shell.id
  );
}

/**
 * Put away, bring back and rename, each with its Undo in the toast: putting away is the
 * engine's archive, which keeps every message, version and page. `remove` is the one that
 * deletes, after its own sheet (DeleteSheet); it has no Undo, and in a Family profile the
 * engine refuses it without a grown-up's yes for that one conversation.
 */
export function useTidy() {
  const family = useFamily();
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchive = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const pinThread = useAtomCommand(threadEnvironment.pin, { reportFailure: false });
  const unpinThread = useAtomCommand(threadEnvironment.unpin, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });

  const bringBack = async (
    shell: EnvironmentThreadShell,
    options: { readonly reopen?: boolean; readonly toast?: boolean } = {},
  ): Promise<TidyOutcome> => {
    const outcome = await unarchive({
      environmentId: shell.environmentId,
      input: { threadId: shell.id },
    });
    if (outcome._tag === "Failure") {
      if (options.toast !== false) showToast(DIDNT_GO);
      return { ok: false, message: DIDNT_GO };
    }
    if (options.reopen) navigate(threadHref(shell.environmentId, shell.id));
    if (options.toast !== false) {
      showToast("Brought back", { label: "Undo", run: () => putAway(shell, { toast: false }) });
    }
    return { ok: true };
  };

  const putAway = async (
    shell: EnvironmentThreadShell,
    options: { readonly toast?: boolean } = {},
  ): Promise<TidyOutcome> => {
    const wasOpen = isOpen(shell);
    const outcome = await archive({
      environmentId: shell.environmentId,
      input: { threadId: shell.id },
    });
    if (outcome._tag === "Failure") {
      if (options.toast !== false) showToast(DIDNT_GO);
      return { ok: false, message: DIDNT_GO };
    }
    // Like Mail: the open conversation leaves the screen with the list row.
    if (wasOpen) navigate(HOME_HREF);
    if (options.toast !== false) {
      showToast("Put away", {
        label: "Undo",
        run: () => bringBack(shell, { reopen: wasOpen, toast: false }),
      });
    }
    return { ok: true };
  };

  const rename = async (
    shell: EnvironmentThreadShell,
    raw: string,
    options: {
      readonly toast?: boolean;
      readonly archived?: boolean;
      /** Undo of a rename: the old title goes back to being the assistant's. */
      readonly undo?: boolean;
    } = {},
  ): Promise<TidyOutcome> => {
    const checked = cleanTitle(raw);
    if (!checked.ok) return { ok: false, message: checked.reason };
    const previous = shell.title;
    if (checked.title === previous) return { ok: true };
    const outcome = await updateMetadata({
      environmentId: shell.environmentId,
      input: { threadId: shell.id, title: checked.title },
    });
    if (outcome._tag === "Failure") return { ok: false, message: DIDNT_GO };
    if (options.undo) forgetRename(shell.id);
    else rememberRename(shell.id, checked.title);
    if (options.archived) refreshOldConversations(shell.environmentId);
    // The fridge's magnets carry the name too.
    void refreshFridge();
    // An empty old title (never named) has nothing to go back to.
    if (options.toast !== false && previous.trim().length > 0) {
      showToast("Renamed", {
        label: "Undo",
        run: () =>
          rename({ ...shell, title: checked.title }, previous, {
            toast: false,
            undo: true,
            ...(options.archived ? { archived: true } : {}),
          }),
      });
    }
    return { ok: true };
  };

  /**
   * Pin to the top, or unpin, with Undo. Both are the engine's own pin commands for this one
   * conversation, so they change only its place in the list, never who can see it.
   */
  const setPinned = async (
    shell: Pick<EnvironmentThreadShell, "environmentId" | "id">,
    pinned: boolean,
    options: { readonly toast?: boolean } = {},
  ): Promise<TidyOutcome> => {
    const run = pinned ? pinThread : unpinThread;
    const outcome = await run({
      environmentId: shell.environmentId,
      input: { threadId: shell.id },
    });
    if (outcome._tag === "Failure") {
      if (options.toast !== false) showToast(DIDNT_GO);
      return { ok: false, message: DIDNT_GO };
    }
    if (options.toast !== false) {
      showToast(pinToastMessage(pinned), {
        label: "Undo",
        run: () => setPinned(shell, !pinned, { toast: false }),
      });
    }
    return { ok: true };
  };

  /**
   * Deletes for good. In a Family profile the delete sheet collects the code and the engine
   * records a yes for this one conversation, spent by the delete.
   */
  const remove = async (
    shell: EnvironmentThreadShell,
    options: { readonly archived?: boolean; readonly title?: string } = {},
    parentCode?: string,
  ): Promise<DeleteOutcome> => {
    const allowed = await family.requireParentCode("deleteConversation", {
      requestId: deleteConversationApprovalId(shell.id),
      ...(parentCode === undefined ? {} : { code: parentCode }),
    });
    if (!allowed) return { kind: "cancelled" };
    const wasOpen = isOpen(shell);
    const outcome = await deleteThread({
      environmentId: shell.environmentId,
      input: { threadId: shell.id },
    });
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      const message = cause instanceof Error ? cause.message : String(cause);
      return { kind: "failed", message: isFamilyRefusal(message) ? NEEDS_GROWN_UP : DIDNT_GO };
    }
    if (wasOpen) navigate(HOME_HREF);
    if (options.archived) refreshOldConversations(shell.environmentId);
    // Its magnet comes off the fridge (the page itself stays in the project).
    void refreshFridge();
    showToast(`Deleted ${quotedName(options.title ?? shell.title)}`);
    return { kind: "deleted" };
  };

  return { putAway, bringBack, rename, remove, setPinned };
}
