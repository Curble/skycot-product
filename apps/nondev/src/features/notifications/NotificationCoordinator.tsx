// Turns the conversation list into OS notifications (macOS Notification Centre in the desktop
// app, the browser's own in a browser). Mounted once in the app shell. Reuses the stock client's
// sound, tag and Dock-badge helpers (apps/web/src/threadNotifications.ts) so both clients ping
// and badge the same way; what pings, and the words, are SKYCOT's own (./decide.ts).
//
// Only while the window is not in front: someone looking at SKYCOT sees the list's dots.
import { useAtomValue } from "@effect/atom-react";
import { workRootsFor } from "@t3tools/skycot-rules/questions";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  playNotificationSound,
  setNotificationBadge,
  threadNotificationTag,
  unlockNotificationAudio,
} from "~/threadNotifications";

import { toolCallInputFor } from "../../plain/approvals";
import { navigate, threadHref } from "../../router";
import { conversationRowsAtom } from "../../state/conversations";
import { projectAtomOrEmpty } from "../../state/projects";
import { environmentThreads, environmentThreadShells } from "../../state/threads";
import { useCrew } from "../../themes/useCrew";
import { familyHoldFor, toolItemTypeFor } from "../family/cards";
import { useFamily } from "../family/FamilyProvider";
import {
  decide,
  firstSeenMark,
  groupOf,
  markFor,
  notificationText,
  type NotifyEvent,
  type ThreadMark,
} from "./decide";
import { readPermission, useNotifySettings } from "./prefs";

/**
 * A step SKYCOT's rules answer on their own must not ping, so an ask waits this long first; in a
 * Family profile it is also the time the probe has to judge the card.
 */
const SETTLE_MS = 2_500;

interface Target {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly project: string | null;
}

function windowInFront(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

export function NotificationCoordinator() {
  const rows = useAtomValue(conversationRowsAtom);
  const settings = useNotifySettings();
  const family = useFamily();
  const crew = useCrew();
  const marks = useRef(new Map<string, ThreadMark>());
  // A little before mount, so a conversation started as the page opened still counts.
  const [watchingSince] = useState(() => Date.now() - 10_000);
  const shown = useRef(new Map<string, Notification>());
  /** Family profile: whether only a grown-up may allow each waiting step, by request id. */
  const grownUpSteps = useRef(new Map<string, boolean>());
  const anyOn = settings.finished || settings.needsOk || settings.failed;

  const clearShown = useEffectEvent(() => {
    for (const notification of shown.current.values()) notification.close();
    shown.current.clear();
    setNotificationBadge(0);
  });

  // Coming back to SKYCOT clears what was shown and the Dock badge (the desktop app also tells
  // us when its window is focused).
  useEffect(() => {
    if (!anyOn) return;
    const clear = () => clearShown();
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [anyOn]);

  // Browsers only play sound after a click or key press on the page.
  useEffect(() => {
    if (!settings.sound) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [settings.sound]);

  const deliver = useEffectEvent((event: NotifyEvent, target: Target) => {
    if (!settings[groupOf(event)] || windowInFront() || readPermission() !== "granted") return;
    const text = notificationText(event, { builder: crew.builder.name, project: target.project });
    try {
      const tag = threadNotificationTag(target.environmentId, target.threadId);
      const notification = new Notification(text.title, { body: text.body, tag, silent: true });
      shown.current.get(tag)?.close();
      shown.current.set(tag, notification);
      setNotificationBadge(shown.current.size);
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow?.().catch(() => undefined);
        navigate(threadHref(target.environmentId, target.threadId));
      });
    } catch {
      // Some browsers expose Notification but refuse to show one.
      return;
    }
    if (settings.sound) {
      void playNotificationSound(
        event === "finished" ? "completion" : "input",
        () => readPermission() === "granted",
      );
    }
  });

  /** Still the same moment after a short wait: nobody (and no rule) answered it meanwhile. */
  const stillWaiting = (key: string, attention: string | null) =>
    marks.current.get(key)?.attention === attention;

  const onRows = useEffectEvent((current: typeof rows) => {
    const next = new Map<string, ThreadMark>();
    for (const row of current) {
      const key = `${row.shell.environmentId}:${row.shell.id}`;
      const mark = markFor(row.shell, row.status);
      next.set(key, mark);
      const event = decide(
        marks.current.get(key) ?? firstSeenMark(row.shell.createdAt, watchingSince),
        mark,
      );
      if (event === null || !settings[groupOf(event)]) continue;
      const target: Target = {
        key,
        environmentId: row.shell.environmentId,
        threadId: row.shell.id,
        project: row.project?.title ?? null,
      };
      if (event === "needs-ok") {
        const requestId = mark.requestId;
        window.setTimeout(() => {
          if (!stillWaiting(key, mark.attention)) return;
          // A card the probe could not judge in time is announced as a grown-up's: the safer
          // ping for a parent.
          const grownUp =
            family.enabled && requestId !== null && grownUpSteps.current.get(requestId) !== false;
          deliver(grownUp ? "needs-grown-up" : "needs-ok", target);
        }, SETTLE_MS);
        continue;
      }
      deliver(event, target);
    }
    marks.current = next;
    if (grownUpSteps.current.size > 200) grownUpSteps.current.clear();
  });

  // The list changing is the outside event: compare it with the last one seen.
  useEffect(() => onRows(rows), [rows]);

  // Family profile: each conversation with a waiting step is read just long enough to judge it.
  const waiting = family.enabled
    ? rows.filter((row) => row.shell.hasPendingApprovals && row.shell.source.pendingRuntimeRequest)
    : [];
  return waiting.map((row) => {
    const requestId = row.shell.source.pendingRuntimeRequest!.id;
    return (
      <GrownUpProbe
        key={`${row.shell.environmentId}:${row.shell.id}:${requestId}`}
        environmentId={row.shell.environmentId}
        threadId={row.shell.id}
        requestId={requestId}
        onJudged={(grownUp) => grownUpSteps.current.set(requestId, grownUp)}
      />
    );
  });
}

/**
 * Judges one waiting step with the same rules the card uses (and the engine enforces). Mounted
 * only while the step waits. If it cannot tell, it says "needs a grown-up".
 */
function GrownUpProbe({
  environmentId,
  threadId,
  requestId,
  onJudged,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly requestId: string;
  readonly onJudged: (grownUp: boolean) => void;
}) {
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  const shell = useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId }));
  const project = useAtomValue(projectAtomOrEmpty({ environmentId, projectId: shell?.projectId }));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const report = useEffectEvent((grownUp: boolean) => onJudged(grownUp));

  useEffect(() => {
    if (AsyncResult.isFailure(result)) {
      report(true);
      return;
    }
    if (projection === null) return;
    const item = projection.turnItems.find(
      (candidate) => candidate.type === "approval_request" && candidate.requestId === requestId,
    );
    if (item === undefined || item.type !== "approval_request") {
      report(true);
      return;
    }
    const roots = workRootsFor({
      projectFolder: project?.workspaceRoot ?? null,
      worktreePath: shell?.worktreePath ?? null,
      questionsRoot: project?.isScratch ? project.workspaceRoot : null,
    });
    const hold = familyHoldFor(item, {
      ...roots,
      toolCallInput: toolCallInputFor(item, projection.turnItems),
      toolItemType: toolItemTypeFor(item, projection.turnItems),
    });
    report(hold !== null);
  }, [result, projection, project, shell, requestId]);

  return null;
}
