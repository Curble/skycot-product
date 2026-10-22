// "Read it to me" on the Crew's replies, and the automatic read-aloud of a reply that has just
// finished while the conversation is open. Old replies are never read out on opening a
// conversation: only one that finished streaming on screen, or arrived complete just now.
import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type * as DateTime from "effect/DateTime";

import { toIso } from "../conversation/cards/time";
import { speaker, useIsSpeaking, useVoiceSettings } from "./browser";
import { voiceCopy } from "./copy";

/** A reply that completed this long before its bubble mounted still counts as "just now". */
const FRESH_MS = 4_000;

export function ReadAloudButton({ id, text }: { readonly id: string; readonly text: string }) {
  const settings = useVoiceSettings();
  const speaking = useIsSpeaking(id);
  if (!settings.canSpeak) return null;
  return (
    <button
      type="button"
      className="fm-readaloud"
      aria-pressed={speaking}
      data-speaking={speaking ? "" : undefined}
      onClick={() => {
        if (speaking) speaker().stop();
        else speaker().speak(id, text, { rate: settings.rate });
      }}
    >
      {speaking ? (
        <Square size={11} strokeWidth={2.4} aria-hidden />
      ) : (
        <Volume2 size={13} strokeWidth={2} aria-hidden />
      )}
      {speaking ? voiceCopy.stopReading : voiceCopy.readLabel}
    </button>
  );
}

export function useAutoReadAloud(item: {
  readonly id: string;
  readonly text: string;
  readonly streaming: boolean;
  readonly completedAt?: DateTime.Utc | string | null;
  readonly updatedAt: DateTime.Utc | string;
}) {
  const settings = useVoiceSettings();
  const [mountedAt] = useState(() => Date.now());
  const sawStreaming = useRef(false);
  const { id, text, streaming } = item;
  const finishedAt = Date.parse(toIso(item.completedAt ?? item.updatedAt) ?? "");
  const enabled = settings.readAloud;
  const rate = settings.rate;
  useEffect(() => {
    if (streaming) {
      sawStreaming.current = true;
      return;
    }
    const fresh = sawStreaming.current || finishedAt >= mountedAt - FRESH_MS;
    sawStreaming.current = false;
    if (!enabled || !fresh || document.visibilityState === "hidden") return;
    if (text.trim().length === 0) return;
    const instance = speaker();
    if (instance.markAutoRead(id)) instance.speak(id, text, { rate });
  }, [streaming, enabled, id, text, rate, finishedAt, mountedAt]);
}
