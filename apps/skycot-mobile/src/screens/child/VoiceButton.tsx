/**
 * Talk instead of type. Shown only when a grown-up turned talking on for this child on the Mac
 * (the child's voice settings), and only on a device that recognises speech by itself.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable } from "react-native";

import { SkycotSpeech } from "../../../modules/skycot-speech";
import { Symbol, haptic } from "../../ui/kit";
import { useTheme } from "../../ui/theme";

export function VoiceButton(props: { readonly onWords: (words: string) => void }) {
  const theme = useTheme();
  const [listening, setListening] = useState(false);
  const [usable, setUsable] = useState(false);
  const latest = useRef("");
  const onWords = useRef(props.onWords);
  onWords.current = props.onWords;

  useEffect(() => {
    if (SkycotSpeech === null) return;
    void SkycotSpeech.availability().then((state) => setUsable(state === "available"));
    const transcript = SkycotSpeech.addListener("onTranscript", (event) => {
      latest.current = event.text;
    });
    const ended = SkycotSpeech.addListener("onEnd", () => {
      setListening(false);
      if (latest.current.trim().length > 0) onWords.current(latest.current.trim());
      latest.current = "";
    });
    return () => {
      transcript.remove();
      ended.remove();
    };
  }, []);

  if (SkycotSpeech === null || !usable) return null;
  const speech = SkycotSpeech;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? "Stop talking" : "Talk instead of typing"}
      hitSlop={6}
      style={{ paddingBottom: 6 }}
      onPress={async () => {
        haptic();
        if (listening) {
          await speech.stop();
          return;
        }
        if (!(await speech.requestPermissions())) return;
        latest.current = "";
        setListening(true);
        await speech.start().catch(() => setListening(false));
      }}
    >
      <Symbol
        name={listening ? "waveform.circle.fill" : "mic.circle.fill"}
        size={32}
        color={listening ? theme.color.red : theme.color.label2}
      />
    </Pressable>
  );
}
