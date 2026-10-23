/**
 * A new conversation: where it goes (a project, or Just ask), the words (a starter card's, or
 * the child's own), voice typing when a grown-up allowed it, and the personal-details shield
 * before anything leaves the device. It always runs "Ask me first" and as a plan first; the
 * engine holds every child's turn to both whatever is sent (FAMILY.md, "Plan first").
 */
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  describePersonalCategories,
  findPersonalDetails,
  personalCategories,
  rewriteWithNicknames,
} from "@t3tools/skycot-rules/personal";
import type { ModelSelection } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, ScrollView, TextInput, View } from "react-native";

import { KID_STARTERS, starterPrompt } from "../../../../nondev/src/features/starters/starters";
import { JUST_ASK_COPY } from "../../../../nondev/src/features/questions/questions";
import type { StackRoutes } from "../../app/routes";
import { useChild } from "../../app/child/ChildContext";
import { isQuestionsProject } from "../../data/conversations";
import { useMacData } from "../../data/MacData";
import { defaultModelSelection, openQuestions, startConversation } from "../../engine/engine";
import { BUILDER_NAME } from "../../ui/brand";
import { Banner, Button, Card, Row, Section, Symbol, Txt, haptic } from "../../ui/kit";
import { useTheme } from "../../ui/theme";
import { VoiceButton } from "./VoiceButton";
import { titleFrom } from "./titles";

type Target = { readonly macId: string; readonly projectId: string | null };

export function NewConversationScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const route = useRoute<RouteProp<StackRoutes, "NewConversation">>();
  const child = useChild();
  const { byMac } = useMacData();
  const starter =
    KID_STARTERS.find((candidate) => candidate.id === route.params?.starterId) ?? null;
  const [text, setText] = useState(() => (starter ? starterPrompt(starter) : ""));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shieldShown, setShieldShown] = useState(false);

  const projects = useMemo(
    () =>
      child.macs.flatMap((mac) =>
        (byMac[mac.macId]?.shell?.projects ?? [])
          .filter(
            (project) => !isQuestionsProject(project, child.questionsRoots[mac.macId] ?? null),
          )
          .map((project) => ({ mac, project })),
      ),
    [child.macs, byMac, child.questionsRoots],
  );
  const firstMac = child.macs[0] ?? null;
  const [target, setTarget] = useState<Target | null>(() =>
    route.params?.question || projects.length === 0
      ? firstMac === null
        ? null
        : { macId: firstMac.macId, projectId: null }
      : { macId: projects[0]!.mac.macId, projectId: projects[0]!.project.id },
  );
  const mac = child.macs.find((candidate) => candidate.macId === target?.macId) ?? null;
  const me = mac === null ? null : child.childOn(mac);
  const voiceAllowed = me?.voice.typing === true;
  const asleep = mac === null ? false : child.sessionOn(mac)?.limits?.asleep === true;
  const several = child.macs.length > 1;

  const details = findPersonalDetails(text);
  const caught =
    details.length > 0 ? describePersonalCategories(personalCategories(details)) : null;

  const send = async (words: string) => {
    if (mac === null || target === null) return;
    const config = child.configs[mac.macId];
    const project =
      projects.find((entry) => entry.project.id === target.projectId)?.project ?? null;
    const model = config
      ? defaultModelSelection(
          config.providers,
          (project?.defaultModelSelection ?? null) as ModelSelection | null,
        )
      : null;
    if (model === null) {
      setProblem(
        "Nothing on the Mac can build yet. Ask a grown-up to set up an AI helper on the Mac.",
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const projectId = target.projectId ?? (await openQuestions(mac.transport)).projectId;
      const { threadId } = await startConversation(mac.transport, {
        projectId,
        title:
          starter && words === starterPrompt(starter).trim() ? starter.title : titleFrom(words),
        text: words,
        modelSelection: model,
        runtimeMode: "approval-required",
        interactionMode: "plan",
      });
      haptic("success");
      navigation.replace("Conversation", { macId: mac.macId, threadId, title: titleFrom(words) });
    } catch {
      setProblem("SKYCOT couldn't reach the Mac just now. Check it's awake, then try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSend = () => {
    const words = text.trim();
    if (words.length === 0) return;
    if (caught !== null) {
      setShieldShown(true);
      haptic("warning");
      return;
    }
    void send(words);
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={90}
      style={{ flex: 1, backgroundColor: theme.color.background }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}>
          <Section title="Where it goes">
            {projects.map(({ mac: owner, project }) => (
              <Row
                key={`${owner.macId}:${project.id}`}
                title={project.title}
                subtitle={several ? owner.macName : null}
                leading={<Symbol name="folder.fill" size={22} />}
                trailing={
                  target?.projectId === project.id && target.macId === owner.macId ? (
                    <Symbol name="checkmark" size={17} weight="semibold" />
                  ) : null
                }
                onPress={() => setTarget({ macId: owner.macId, projectId: project.id })}
              />
            ))}
            {child.macs.map((owner) => (
              <Row
                key={`${owner.macId}:questions`}
                title={JUST_ASK_COPY.choice}
                subtitle={
                  several
                    ? `${JUST_ASK_COPY.choiceHint} · ${owner.macName}`
                    : JUST_ASK_COPY.choiceHint
                }
                leading={<Symbol name="questionmark.bubble.fill" size={22} />}
                trailing={
                  target?.projectId === null && target.macId === owner.macId ? (
                    <Symbol name="checkmark" size={17} weight="semibold" />
                  ) : null
                }
                onPress={() => setTarget({ macId: owner.macId, projectId: null })}
              />
            ))}
          </Section>

          <View style={{ marginHorizontal: 16, marginTop: 22, gap: 10 }}>
            <Txt
              variant="footnote"
              tone="label2"
              style={{ textTransform: "uppercase", marginLeft: 16 }}
            >
              {starter ? starter.title : "What shall we make?"}
            </Txt>
            <Card padded={false}>
              <TextInput
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  setShieldShown(false);
                }}
                multiline
                autoFocus={starter === null}
                placeholder={
                  target?.projectId === null
                    ? JUST_ASK_COPY.placeholder
                    : "Say what you'd like to make, like telling a friend."
                }
                placeholderTextColor={theme.color.label3}
                accessibilityLabel="Your message"
                style={{
                  minHeight: 160,
                  padding: 16,
                  fontSize: 17,
                  color: theme.color.label,
                  fontFamily: theme.font.family,
                  textAlignVertical: "top",
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingHorizontal: 12,
                  paddingBottom: 10,
                }}
              >
                <Txt variant="caption" tone="label3">
                  {starter
                    ? "Change the words in [brackets], then Send."
                    : `${BUILDER_NAME} shows you a plan before making anything.`}
                </Txt>
                {voiceAllowed ? (
                  <VoiceButton
                    onWords={(words) =>
                      setText((current) => (current ? `${current} ${words}` : words))
                    }
                  />
                ) : null}
              </View>
            </Card>
            {shieldShown && caught !== null ? (
              <Card style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Symbol name="hand.raised.fill" size={22} color={theme.color.orange} />
                  <Txt variant="headline" style={{ flex: 1 }}>
                    That looks private
                  </Txt>
                </View>
                <Txt>{`SKYCOT spotted ${caught}. Personal details stay home.`}</Txt>
                <Button
                  title="Send with nicknames"
                  onPress={() => {
                    const rewritten = rewriteWithNicknames(text);
                    setText(rewritten);
                    setShieldShown(false);
                    void send(rewritten.trim());
                  }}
                />
                <Button
                  title="Change it myself"
                  kind="grey"
                  onPress={() => setShieldShown(false)}
                />
              </Card>
            ) : null}
            {asleep ? (
              <Banner
                tone="warning"
                text="SKYCOT is asleep right now. Your message can wait until it wakes."
              />
            ) : null}
            {problem ? <Banner tone="warning" text={problem} /> : null}
            <Button
              title={busy ? "Sending…" : "Send"}
              icon="paperplane.fill"
              busy={busy}
              disabled={text.trim().length === 0 || target === null || asleep}
              onPress={onSend}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
