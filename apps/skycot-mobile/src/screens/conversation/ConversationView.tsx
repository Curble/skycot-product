/**
 * One conversation, as SKYCOT's plain cards: what you said, what Sam said, the plan (Build it /
 * Change the plan), Ask a grown-up, What changed (Open it / Undo all of it). On a grown-up's
 * phone it is read only: the Requests page answers, never this screen.
 *
 * The engine has the final say on everything here: a child's Allow on a step that needs a
 * grown-up is refused without the parent code, plan first and bedtime hold whatever this screen
 * sends (docs/nondev/FAMILY.md, "What the engine checks").
 */
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { familyApi } from "../../family/api";
import { respondToRequest, sendMessage, stopConversation, undoTo } from "../../engine/engine";
import { buildTimeline, isWorking, type TimelineEntry } from "../../engine/timeline";
import { useThread } from "../../data/hooks";
import type { ThreadProjection } from "../../engine/types";
import type { Mac } from "../../links/store";
import { BUILDER_NAME } from "../../ui/brand";
import {
  Banner,
  Button,
  ButtonRow,
  Card,
  Mascot,
  ParentCodeSheet,
  Pill,
  Sheet,
  Spinner,
  Symbol,
  Txt,
  haptic,
} from "../../ui/kit";
import { useTheme } from "../../ui/theme";
import { VoiceButton } from "../child/VoiceButton";

const BUILD_IT_TEXT = "Build it: go ahead with the plan.";

export function ConversationView(props: {
  readonly mac: Mac;
  readonly threadId: string;
  readonly readOnly: boolean;
  /** A child's device: talking is allowed for this child (the Mac's grown-up switch). */
  readonly voiceAllowed?: boolean;
  readonly childId?: string | null;
  readonly onOpenPage?: () => void;
  /** The conversation's own title, once it has loaded (a link may not know it). */
  readonly onTitle?: (title: string) => void;
  /** Development builds: a demo conversation (src/dev) instead of the Mac's. */
  readonly demo?: ThreadProjection;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const thread = useThread(props.demo ? null : props.mac, props.threadId);
  const projection = props.demo ?? thread.value;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"reply" | "change-plan">("reply");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [parentAsk, setParentAsk] = useState<{
    readonly requestId: string;
    readonly reason: string;
  } | null>(null);
  const [undo, setUndo] = useState<{
    readonly scopeId: string;
    readonly checkpointId: string;
  } | null>(null);
  const [busyCard, setBusyCard] = useState<string | null>(null);

  const title = projection?.thread.title ?? null;
  const onTitle = props.onTitle;
  useEffect(() => {
    if (title !== null) onTitle?.(title);
  }, [title, onTitle]);
  const timeline = useMemo<Array<TimelineEntry>>(
    () =>
      projection === null
        ? []
        : buildTimeline(projection, {
            projectRoot: projection.thread.worktreePath ?? null,
            assistantName: BUILDER_NAME,
          }),
    [projection],
  );
  const working = projection !== null && isWorking(projection);
  const waitingAsk = timeline.some((entry) => entry.kind === "ask" && entry.state === "waiting");
  const lastPlan = timeline.findLast((entry) => entry.kind === "plan");

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(timer);
  }, [timeline.length, working]);

  const run = async (key: string, job: () => Promise<unknown>) => {
    if (props.demo) return;
    setBusyCard(key);
    setProblem(null);
    try {
      await job();
      await thread.refresh();
    } catch (cause) {
      setProblem(plainFailure(cause));
    } finally {
      setBusyCard(null);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (text.length === 0 || sending || props.demo) return;
    setSending(true);
    setProblem(null);
    try {
      await sendMessage(props.mac.transport, { threadId: props.threadId, text });
      setDraft("");
      setMode("reply");
      haptic("success");
      await thread.refresh();
    } catch (cause) {
      setProblem(plainFailure(cause));
    } finally {
      setSending(false);
    }
  };

  const allow = async (entry: Extract<TimelineEntry, { kind: "ask" }>) => {
    if (entry.card.grownUp !== null) {
      setParentAsk({ requestId: entry.requestId, reason: entry.card.grownUp });
      return;
    }
    await run(entry.id, () =>
      respondToRequest(props.mac.transport, {
        threadId: props.threadId,
        requestId: entry.requestId,
        decision: "accept",
      }),
    );
  };

  if (projection === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.background, justifyContent: "center" }}>
        {thread.problem ? (
          <View style={{ padding: 24 }}>
            <Banner
              tone="warning"
              text="This conversation didn't load. Check the Mac is awake, then try again."
            />
          </View>
        ) : (
          <Spinner />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 24 }}
      >
        <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", gap: 14 }}>
          {timeline.length === 0 ? (
            <Txt tone="label2" center>
              Nothing has been said yet.
            </Txt>
          ) : null}
          {timeline.map((entry) => (
            <TimelineCard
              key={entry.id}
              entry={entry}
              readOnly={props.readOnly}
              busy={busyCard === entry.id}
              isLatestPlan={entry === lastPlan}
              onBuild={(planId) =>
                run(entry.id, () =>
                  sendMessage(props.mac.transport, {
                    threadId: props.threadId,
                    text: BUILD_IT_TEXT,
                    plan: { planId },
                  }),
                )
              }
              onChangePlan={() => {
                setMode("change-plan");
                input.current?.focus();
              }}
              onAllow={allow}
              onDecline={(ask) =>
                run(ask.id, () =>
                  respondToRequest(props.mac.transport, {
                    threadId: props.threadId,
                    requestId: ask.requestId,
                    decision: "decline",
                  }),
                )
              }
              onUndo={(target) => setUndo(target)}
              onOpenPage={props.onOpenPage}
            />
          ))}
          {working && !waitingAsk ? <WorkingLine /> : null}
          {!working && timeline.at(-1)?.kind === "me" ? (
            <Txt variant="footnote" tone="label2" center>
              {`${BUILDER_NAME} finished without saying anything. Try asking again.`}
            </Txt>
          ) : null}
          {problem ? <Banner tone="warning" text={problem} /> : null}
        </View>
      </ScrollView>
      {props.readOnly ? (
        <View
          style={{
            padding: 14,
            paddingBottom: Math.max(14, insets.bottom),
            borderTopWidth: 0.5,
            borderTopColor: theme.color.separator,
            backgroundColor: theme.color.cardRaised,
          }}
        >
          <Txt variant="footnote" tone="label2" center>
            Read only on this device.
          </Txt>
        </View>
      ) : (
        <Composer
          inputRef={input}
          value={draft}
          onChange={setDraft}
          onSend={send}
          sending={sending}
          working={working}
          mode={mode}
          voiceAllowed={props.voiceAllowed === true}
          onStop={() => run("stop", () => stopConversation(props.mac.transport, props.threadId))}
        />
      )}
      <ParentCodeSheet
        visible={parentAsk !== null}
        title="Ask a grown-up"
        description={
          parentAsk === null
            ? ""
            : `${parentAsk.reason} A grown-up enters the parent code to allow it, this once.`
        }
        actionLabel="Allow"
        onClose={() => setParentAsk(null)}
        onCode={async (code) => {
          if (parentAsk === null) return null;
          const yes = await familyApi.verify(props.mac.transport, {
            code,
            purpose: "approve",
            requestId: parentAsk.requestId,
          });
          if (!yes.ok) return yes.message;
          try {
            await respondToRequest(props.mac.transport, {
              threadId: props.threadId,
              requestId: parentAsk.requestId,
              decision: "accept",
            });
          } catch (cause) {
            return plainFailure(cause);
          }
          setParentAsk(null);
          await thread.refresh();
          return null;
        }}
      />
      <Sheet visible={undo !== null} title="Undo all of it?" onClose={() => setUndo(null)}>
        <Txt>
          The files {BUILDER_NAME} changed go back to how they were before, and the conversation
          goes back too. This can't itself be undone.
        </Txt>
        <Button
          title="Undo all of it"
          kind="destructive"
          onPress={() => {
            const target = undo;
            setUndo(null);
            if (target !== null) {
              void run("undo", () =>
                undoTo(props.mac.transport, { threadId: props.threadId, ...target }),
              ).then(() => haptic("success"));
            }
          }}
        />
        <Button title="Keep it" kind="grey" onPress={() => setUndo(null)} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function plainFailure(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  if (/parent code/iu.test(text))
    return "That step needs a grown-up. Ask one to enter the parent code.";
  if (/asleep/iu.test(text)) return "SKYCOT is asleep right now. Your work is saved.";
  return "SKYCOT couldn't reach the Mac just now. Check it's awake, then try again.";
}

function WorkingLine() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 }}>
      <Mascot pose="thinking" size={36} />
      <Txt tone="label2">{BUILDER_NAME} is building…</Txt>
    </View>
  );
}

function Bubble(props: { readonly mine: boolean; readonly text: string }) {
  const theme = useTheme();
  const mine = props.mine;
  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
      {!mine ? (
        <Txt variant="caption" tone="label2" style={{ marginLeft: 12, marginBottom: 3 }}>
          {BUILDER_NAME}
        </Txt>
      ) : null}
      <View
        style={{
          maxWidth: "86%",
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: theme.radius.bubble,
          backgroundColor: mine ? theme.color.bubbleMe : theme.color.bubbleCrew,
          borderWidth: theme.look === "workshop" ? 1.5 : 0,
          borderColor: theme.color.outline,
        }}
      >
        <Txt
          selectable
          style={{
            color: mine && theme.look === "apple" ? "#FFFFFF" : theme.color.label,
          }}
        >
          {props.text}
        </Txt>
      </View>
    </View>
  );
}

/** A plan's markdown as plain numbered steps: no symbols a child has to read past. */
function planSteps(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "")
        .replace(/[*_`#>]+/gu, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

function TimelineCard(props: {
  readonly entry: TimelineEntry;
  readonly readOnly: boolean;
  readonly busy: boolean;
  readonly isLatestPlan: boolean;
  readonly onBuild: (planId: string) => void;
  readonly onChangePlan: () => void;
  readonly onAllow: (entry: Extract<TimelineEntry, { kind: "ask" }>) => void;
  readonly onDecline: (entry: Extract<TimelineEntry, { kind: "ask" }>) => void;
  readonly onUndo: (target: { readonly scopeId: string; readonly checkpointId: string }) => void;
  readonly onOpenPage: (() => void) | undefined;
}) {
  const theme = useTheme();
  const { entry } = props;
  switch (entry.kind) {
    case "me":
      return <Bubble mine text={entry.text} />;
    case "crew":
      return <Bubble mine={false} text={entry.text} />;
    case "oops":
      return <Banner tone="warning" text={entry.text} />;
    case "plan": {
      const steps = planSteps(entry.markdown);
      const subtitle =
        entry.state === "writing"
          ? "Writing the plan…"
          : entry.state === "replaced"
            ? "Replaced by a newer plan"
            : entry.state === "done"
              ? "Carried out"
              : entry.state === "building"
                ? "Building it now"
                : `${steps.length} ${steps.length === 1 ? "step" : "steps"} · nothing is made until you say so`;
      return (
        <Card>
          <CardHeader
            symbol="list.bullet.clipboard"
            color={theme.color.accent}
            title="Here's my plan"
            subtitle={subtitle}
          />
          <View style={{ gap: 8, marginTop: 12 }}>
            {steps.map((step, index) => (
              <View key={index} style={{ flexDirection: "row", gap: 10 }}>
                <Txt weight="700" tone="accent" style={{ minWidth: 20 }}>
                  {`${index + 1}.`}
                </Txt>
                <Txt style={{ flex: 1 }}>{step}</Txt>
              </View>
            ))}
          </View>
          {entry.state === "ready" && props.isLatestPlan && !props.readOnly ? (
            <ButtonRow style={{ marginTop: 16 }}>
              <Button
                title="Build it"
                icon="hammer.fill"
                busy={props.busy}
                onPress={() => props.onBuild(entry.planId)}
                style={{ flex: 1 }}
                size="medium"
              />
              <Button
                title="Change the plan"
                kind="tinted"
                onPress={props.onChangePlan}
                style={{ flex: 1 }}
                size="medium"
              />
            </ButtonRow>
          ) : null}
        </Card>
      );
    }
    case "ask": {
      const waiting = entry.state === "waiting";
      const grownUp = entry.card.grownUp !== null;
      const decided =
        entry.state === "allowed"
          ? "Allowed, this once."
          : entry.state === "declined"
            ? "You said no. Nothing ran."
            : entry.state === "ended"
              ? "This one ended before anyone answered."
              : null;
      return (
        <View style={{ gap: 8 }}>
          {grownUp && waiting ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Mascot pose="ask-a-grown-up" size={40} />
              <Txt weight="600">Time to find a grown-up</Txt>
            </View>
          ) : null}
          <Card>
            <CardHeader
              symbol={grownUp ? "hand.raised.fill" : "questionmark.circle.fill"}
              color={
                decided ? theme.color.label3 : grownUp ? theme.color.orange : theme.color.accent
              }
              title={entry.card.title}
              subtitle={
                decided ??
                (grownUp
                  ? "Needs a grown-up · waiting for a parent"
                  : `${BUILDER_NAME} needs your OK`)
              }
            />
            {waiting ? (
              <View style={{ gap: 10, marginTop: 12 }}>
                <Txt>{entry.card.whatItWants}</Txt>
                {grownUp ? (
                  <Banner
                    tone="warning"
                    text={`${entry.card.grownUp} A grown-up enters the parent code to allow it.`}
                  />
                ) : (
                  <Txt variant="subheadline" tone="label2">
                    {entry.card.whyItMatters}
                  </Txt>
                )}
                {props.readOnly ? (
                  <Txt variant="footnote" tone="label2">
                    Answer this on the Requests page.
                  </Txt>
                ) : (
                  <ButtonRow>
                    <Button
                      title="Don't allow"
                      kind="grey"
                      onPress={() => props.onDecline(entry)}
                      style={{ flex: 1 }}
                      size="medium"
                    />
                    <Button
                      title={grownUp ? "Ask a grown-up" : "Allow once"}
                      busy={props.busy}
                      onPress={() => props.onAllow(entry)}
                      style={{ flex: 1 }}
                      size="medium"
                    />
                  </ButtonRow>
                )}
              </View>
            ) : null}
          </Card>
        </View>
      );
    }
    case "changed":
      return (
        <Card>
          <CardHeader
            symbol={entry.undone ? "arrow.uturn.backward.circle.fill" : "sparkles"}
            color={entry.undone ? theme.color.label3 : theme.color.green}
            title={entry.undone ? "Undone" : "What changed"}
            subtitle={entry.undone ? "Back to how it was before." : entry.headline}
            trailing={
              <Pill text={`${entry.fileCount} ${entry.fileCount === 1 ? "file" : "files"}`} />
            }
          />
          {!entry.undone ? (
            <View style={{ gap: 4, marginTop: 10 }}>
              {entry.lines.map((line, index) => (
                <Txt key={index} variant="subheadline" tone="label2">
                  {`• ${line}`}
                </Txt>
              ))}
            </View>
          ) : null}
          {!entry.undone && !props.readOnly ? (
            <ButtonRow style={{ marginTop: 14 }}>
              {props.onOpenPage ? (
                <Button
                  title="Open it"
                  icon="play.fill"
                  onPress={props.onOpenPage}
                  style={{ flex: 1 }}
                  size="medium"
                />
              ) : null}
              {entry.undo ? (
                <Button
                  title="Undo all of it"
                  kind="tinted"
                  icon="arrow.uturn.backward"
                  onPress={() => props.onUndo(entry.undo!)}
                  style={{ flex: 1 }}
                  size="medium"
                />
              ) : null}
            </ButtonRow>
          ) : null}
        </Card>
      );
  }
}

function CardHeader(props: {
  readonly symbol: Parameters<typeof Symbol>[0]["name"];
  readonly color: string;
  readonly title: string;
  readonly subtitle: string;
  readonly trailing?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
      <Symbol name={props.symbol} size={26} color={props.color} />
      <View style={{ flex: 1 }}>
        <Txt variant="headline">{props.title}</Txt>
        <Txt variant="footnote" tone="label2">
          {props.subtitle}
        </Txt>
      </View>
      {props.trailing}
    </View>
  );
}

function Composer(props: {
  readonly inputRef: React.RefObject<ComponentRef<typeof TextInput> | null>;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly sending: boolean;
  readonly working: boolean;
  readonly mode: "reply" | "change-plan";
  readonly voiceAllowed: boolean;
  readonly onStop: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const placeholder =
    props.mode === "change-plan"
      ? "What should be different? (“skip step 3”)"
      : props.working
        ? "Add a note while it works…"
        : "Reply, or ask for something else…";
  const canSend = props.value.trim().length > 0 && !props.sending;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: Math.max(12, insets.bottom),
        borderTopWidth: 0.5,
        borderTopColor: theme.color.separator,
        backgroundColor: theme.color.cardRaised,
      }}
    >
      {props.working ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          onPress={props.onStop}
          hitSlop={6}
          style={{ paddingBottom: 6 }}
        >
          <Symbol name="stop.circle.fill" size={32} color={theme.color.red} />
        </Pressable>
      ) : null}
      <TextInput
        ref={props.inputRef}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.label3}
        multiline
        accessibilityLabel="Message"
        style={{
          flex: 1,
          minHeight: 40,
          maxHeight: 140,
          backgroundColor: theme.color.card,
          borderRadius: 20,
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: 10,
          fontSize: 17,
          color: theme.color.label,
          fontFamily: theme.font.family,
          borderWidth: theme.look === "workshop" ? 1.5 : 0.5,
          borderColor: theme.look === "workshop" ? theme.color.outline : theme.color.separator,
        }}
      />
      {props.voiceAllowed ? (
        <VoiceButton
          onWords={(words) =>
            props.onChange(props.value.length > 0 ? `${props.value} ${words}` : words)
          }
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        disabled={!canSend}
        onPress={props.onSend}
        hitSlop={6}
        style={{ paddingBottom: 4, opacity: canSend ? 1 : 0.35 }}
      >
        <Symbol name="arrow.up.circle.fill" size={34} color={theme.color.accent} />
      </Pressable>
    </View>
  );
}
