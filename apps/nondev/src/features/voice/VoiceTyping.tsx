// The microphone in the message box: tap to start, tap to stop, words appear in the box as
// they are heard. The listening look is a static ring that changes with the state, never a
// looping animation (performance rules), and the status line says out loud what is happening.
import { Mic, MicOff, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { createVoiceTyping, speaker, speechService } from "./browser";
import { problemSentence, voiceCopy, voiceProviderShort } from "./copy";
import type { VoiceTyping, VoiceTypingState } from "./listening";

export interface VoiceTypingControl {
  readonly state: VoiceTypingState;
  readonly listening: boolean;
  readonly toggle: () => void;
  /** Stop at once and keep what is in the box (typing, sending). */
  readonly cancel: () => void;
  readonly dismissProblem: () => void;
}

export function useVoiceTypingControl({
  value,
  onChange,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}): VoiceTypingControl {
  const [machine] = useState<VoiceTyping>(createVoiceTyping);
  const state = useSyncExternalStore(machine.subscribe, machine.getState, machine.getState);

  // Never listen in the background: a hidden tab, a closed composer or a busy field stops it.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") machine.cancel();
    };
    const onPageHide = () => machine.cancel();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      machine.cancel();
    };
  }, [machine]);
  useEffect(() => {
    if (disabled) machine.cancel();
  }, [disabled, machine]);

  return {
    state,
    listening: state.phase !== "idle",
    toggle: () => {
      if (machine.active) {
        machine.stop();
        return;
      }
      // The speaker would be heard by the microphone.
      speaker().stop();
      machine.start(value, onChange);
    },
    cancel: () => machine.cancel(),
    dismissProblem: () => machine.dismissProblem(),
  };
}

export function MicButton({
  control,
  disabled,
}: {
  readonly control: VoiceTypingControl;
  readonly disabled: boolean;
}) {
  const { phase } = control.state;
  const on = phase !== "idle";
  return (
    <button
      type="button"
      className="fm-mic"
      data-phase={phase}
      aria-pressed={on}
      aria-label={on ? voiceCopy.stopLabel : voiceCopy.micLabel}
      disabled={disabled && !on}
      onClick={control.toggle}
    >
      <span className="fm-mic__ring" aria-hidden />
      <Mic size={20} strokeWidth={2.1} aria-hidden />
    </button>
  );
}

/** The line above the box while listening, or the one plain sentence when it went wrong. */
export function VoiceTypingStatus({ control }: { readonly control: VoiceTypingControl }) {
  const { phase, problem } = control.state;
  if (phase === "idle" && problem === null) return null;
  if (phase === "idle" && problem !== null) {
    return (
      <div className="fm-voice-status fm-voice-status--problem" role="status">
        <MicOff size={14} strokeWidth={2} aria-hidden />
        <span className="fm-voice-status__text">{problemSentence(problem)}</span>
        <button
          type="button"
          className="fm-voice-status__close"
          aria-label="Dismiss"
          onClick={control.dismissProblem}
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>
    );
  }
  const provider = voiceProviderShort(speechService);
  return (
    <div className="fm-voice-status" data-phase={phase} role="status" aria-live="polite">
      <span className="fm-voice-status__dot" aria-hidden />
      <span className="fm-voice-status__text">
        {phase === "starting"
          ? voiceCopy.starting
          : phase === "stopping"
            ? voiceCopy.stopping
            : voiceCopy.listening}
      </span>
      {provider ? <span className="fm-voice-status__by">{provider}</span> : null}
    </div>
  );
}
