import { Mic, MicOff, Volume2 } from "lucide-react";

import { useFamily } from "../../family/FamilyProvider";
import { speaker, useIsSpeaking, useVoiceSettings } from "../../voice/browser";
import { voiceCopy, whereVoiceGoes } from "../../voice/copy";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { StepBadge } from "../../../ui/StepBadge";
import { Switch } from "../../../ui/Switch";
import { useReadAloudChoice, writeReadAloudChoice, writeVoiceTypingOff } from "../localPrefs";
import { SettingsGroup } from "../SettingsGroup";

const SAMPLE_ID = "settings:voice-sample";

/**
 * Settings › Voice: the microphone in the message box, and replies read aloud. Both are
 * per-device. Where the sound of a voice goes is said here in full, because the browser, not
 * SKYCOT, decides it.
 */
export function VoicePane() {
  const voice = useVoiceSettings();
  const family = useFamily();
  const readChoice = useReadAloudChoice();
  const sampleSpeaking = useIsSpeaking(SAMPLE_ID);

  const typingSubtitle =
    voice.typingOffBecause === "browser"
      ? "Not available in this window."
      : voice.typingOffBecause === "parent"
        ? "Switched off by a parent in Settings › Family."
        : voice.typing
          ? "A microphone button sits beside the message box. Tap it, talk, tap it again."
          : "Off. The microphone button is hidden.";

  return (
    <>
      <SettingsGroup
        title="Talk to SKYCOT"
        footer={
          voice.service === "none"
            ? whereVoiceGoes(voice.service)
            : `${whereVoiceGoes(voice.service)} ${voiceCopy.never}`
        }
      >
        <ListRow
          leading={
            <StepBadge state={voice.typing ? "ok" : "todo"} icon={voice.typing ? Mic : MicOff} />
          }
          title="Voice typing"
          subtitle={typingSubtitle}
          trailing={
            voice.typingOffBecause === "browser" || voice.typingOffBecause === "parent" ? null : (
              <Switch
                checked={voice.typing}
                onChange={(on) => writeVoiceTypingOff(!on)}
                label="Voice typing"
              />
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Read replies aloud"
        footer={
          voice.canSpeak
            ? `${voiceCopy.readAloudLocal}${family.enabled ? " A little slower for a Family profile." : ""}`
            : "This browser can't read text aloud."
        }
      >
        <ListRow
          title="Read replies aloud automatically"
          subtitle={
            readChoice === null
              ? family.enabled
                ? "On for a Family profile. Every reply also has a “Read it to me” button."
                : "Off. Every reply has a “Read it to me” button."
              : voice.readAloud
                ? "On. A reply is read once it's finished, while the conversation is open."
                : "Off. Every reply has a “Read it to me” button."
          }
          trailing={
            <Switch
              checked={voice.readAloud}
              disabled={!voice.canSpeak}
              onChange={(on) =>
                writeReadAloudChoice(on === family.enabled ? null : on ? "on" : "off")
              }
              label="Read replies aloud automatically"
            />
          }
        />
        <ListRow
          leading={<StepBadge state="number" icon={Volume2} />}
          title="Hear the voice"
          subtitle="SKYCOT picks a friendly English voice from the ones on this Mac."
          trailing={
            <Button
              size="sm"
              disabled={!voice.canSpeak}
              onClick={() =>
                sampleSpeaking
                  ? speaker().stop()
                  : speaker().speak(SAMPLE_ID, voiceCopy.sample, { rate: voice.rate })
              }
            >
              {sampleSpeaking ? "Stop" : "Play"}
            </Button>
          }
        />
      </SettingsGroup>
    </>
  );
}
