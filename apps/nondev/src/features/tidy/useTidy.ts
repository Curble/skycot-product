import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { useAtomCommand } from "~/state/use-atom-command";

import { HOME_HREF, navigate, parseRoute, threadHref } from "../../router";
import { refreshOldConversations } from "../../state/oldConversations";
import { threadEnvironment } from "../../state/threads";
import { showToast } from "../../ui/Toast";
import { refreshFridge } from "../fridge/store";
import { cleanTitle } from "./tidy";

export type TidyOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

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
 * Put away, bring back and rename, each with its Undo in the toast. Nothing here deletes:
 * putting away is the engine's archive, which keeps every message, version and page.
 */
export function useTidy() {
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchive = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

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
    options: { readonly toast?: boolean; readonly archived?: boolean } = {},
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
            ...(options.archived ? { archived: true } : {}),
          }),
      });
    }
    return { ok: true };
  };

  return { putAway, bringBack, rename };
}
