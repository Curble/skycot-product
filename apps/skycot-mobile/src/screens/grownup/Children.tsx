/**
 * Children: each child on each linked Mac, with today's time and messages, their
 * conversations (read only), their week, and More time. As Phase 1's grown-up phone.
 */
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { View } from "react-native";

import { childLabel, type FamilyChild } from "../../../../nondev/src/features/family/children";
import { todaySummary } from "../../../../nondev/src/features/family-limits/limits";
import type { StackRoutes } from "../../app/routes";
import { useGrownUp } from "../../app/grownup/GrownUpContext";
import { conversationRows, relativeTime, stateLabel } from "../../data/conversations";
import { useMacData } from "../../data/MacData";
import { familyApi, type MoreTimeKind } from "../../family/api";
import { useLinks, type Mac } from "../../links/store";
import { BUILDER_NAME } from "../../ui/brand";
import {
  Avatar,
  Button,
  EmptyState,
  Page,
  ParentCodeField,
  Pill,
  Row,
  Section,
  Segmented,
  Sheet,
  Txt,
  haptic,
} from "../../ui/kit";

export function ChildrenScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const grownUp = useGrownUp();
  const [moreTime, setMoreTime] = useState<{
    readonly mac: Mac;
    readonly child: FamilyChild;
  } | null>(null);
  const several = grownUp.macs.length > 1;
  return (
    <Page>
      {grownUp.macs.map((mac) => {
        const children = grownUp.childrenOn(mac);
        const today = grownUp.byMac[mac.macId]?.today ?? null;
        return (
          <View key={mac.macId}>
            {several ? (
              <Txt variant="title3" style={{ marginHorizontal: 20, marginTop: 22 }}>
                {mac.macName}
              </Txt>
            ) : null}
            {children.length === 0 ? (
              <EmptyState
                pose="hello"
                title="No children yet"
                body="Add a child on the Mac, in Settings › Family."
              />
            ) : null}
            {children.map((child, index) => {
              const label = childLabel(child, index);
              const state =
                today?.children.find((entry) => entry.childId === child.id)?.limits ?? null;
              return (
                <Section key={child.id}>
                  <Row
                    leading={<Avatar person={child} size={44} />}
                    title={label}
                    subtitle={state ? todaySummary(state, child.limits) : "Nothing yet today."}
                    trailing={state?.asleep ? <Pill text="Asleep" tone="accent" /> : null}
                  />
                  <Row
                    title="Conversations"
                    subtitle="Read what they asked and what Sam did."
                    chevron
                    onPress={() =>
                      navigation.navigate("ChildConversations", {
                        macId: mac.macId,
                        childId: child.id,
                      })
                    }
                  />
                  <Row
                    title={`${label}'s week`}
                    subtitle="What they made, asked for and needed help with."
                    chevron
                    onPress={() =>
                      navigation.navigate("Recap", { macId: mac.macId, childId: child.id })
                    }
                  />
                  <Row
                    title="More time"
                    subtitle="15 or 30 minutes, or no bedtime tonight."
                    trailing={
                      <Button
                        title="Give…"
                        kind="tinted"
                        size="small"
                        onPress={() => setMoreTime({ mac, child })}
                      />
                    }
                  />
                </Section>
              );
            })}
          </View>
        );
      })}
      <MoreTimeSheet target={moreTime} onClose={() => setMoreTime(null)} />
    </Page>
  );
}

function MoreTimeSheet(props: {
  readonly target: { readonly mac: Mac; readonly child: FamilyChild } | null;
  readonly onClose: () => void;
}) {
  const { refresh } = useMacData();
  const [kind, setKind] = useState<MoreTimeKind>("extra15");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [given, setGiven] = useState(false);
  const name = props.target?.child.name ?? "them";
  const close = () => {
    setGiven(false);
    setProblem(null);
    setCode("");
    props.onClose();
  };
  const give = async () => {
    if (props.target === null || code.length < 4) return;
    setBusy(true);
    const result = await familyApi.approverMoreTime(props.target.mac.transport, {
      childId: props.target.child.id,
      kind,
      proof: { type: "code", code },
    });
    setBusy(false);
    setCode("");
    if (!result.ok) {
      haptic("warning");
      setProblem(result.message);
      return;
    }
    haptic("success");
    setGiven(true);
    void refresh(props.target.mac.macId);
  };
  return (
    <Sheet
      visible={props.target !== null}
      title={`More time for ${name}`}
      onClose={close}
      closeLabel={given ? "Done" : "Cancel"}
    >
      {given ? (
        <EmptyState pose="yay" title="More time given" body={`${name} can keep going.`}>
          <Button title="Done" onPress={close} style={{ alignSelf: "stretch", marginTop: 12 }} />
        </EmptyState>
      ) : (
        <>
          <Txt tone="label2">SKYCOT wakes for them straight away.</Txt>
          <Segmented
            accessibilityLabel="How much"
            options={[
              { id: "extra15", label: "15 minutes" },
              { id: "extra30", label: "30 minutes" },
              { id: "endBedtime", label: "No bedtime tonight" },
            ]}
            value={kind}
            onChange={setKind}
          />
          <ParentCodeField
            value={code}
            onChange={setCode}
            onSubmit={give}
            problem={problem}
            autoFocus={false}
          />
          <Button
            title={busy ? "Checking…" : "Give time"}
            busy={busy}
            disabled={code.length < 4}
            onPress={give}
          />
        </>
      )}
    </Sheet>
  );
}

export function ChildConversationsScreen() {
  const route = useRoute<RouteProp<StackRoutes, "ChildConversations">>();
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const { macs } = useLinks();
  const { byMac } = useMacData();
  const mac = macs.find((candidate) => candidate.macId === route.params.macId) ?? null;
  const owners = mac ? (byMac[mac.macId]?.today?.threads ?? {}) : {};
  const rows = mac
    ? conversationRows([mac], byMac).filter((row) => owners[row.thread.id] === route.params.childId)
    : [];
  return (
    <Page>
      <Section footer={rows.length === 0 ? "No conversations yet." : "Read only on this device."}>
        {rows.map((row) => (
          <Row
            key={row.key}
            title={row.thread.title}
            subtitle={`${row.projectTitle} · ${stateLabel(row.state, BUILDER_NAME) ?? relativeTime(row.updatedAt)}`}
            chevron
            onPress={() =>
              navigation.navigate("Conversation", {
                macId: row.mac.macId,
                threadId: row.thread.id,
                title: row.thread.title,
                readOnly: true,
              })
            }
          />
        ))}
      </Section>
    </Page>
  );
}

export const childConversationsOptions = () => ({ title: "Conversations" });
