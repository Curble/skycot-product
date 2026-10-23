/**
 * Requests: every "Ask a grown-up" waiting on any linked Mac. Allow once (the parent code
 * here; Face ID once SKYCOT Relay gives the Mac a secure address) or Decline; never "for the
 * session" or "always". The Mac checks the request, the card's fingerprint and the proof every
 * time, and logs who said yes (Phase 1's approver routes).
 */
import { useState } from "react";
import { View } from "react-native";

import { requestHeading } from "../../../../nondev/src/features/family/people";
import { useGrownUp, type WaitingRequest } from "../../app/grownup/GrownUpContext";
import { useMacData } from "../../data/MacData";
import { familyApi } from "../../family/api";
import {
  Avatar,
  Banner,
  Button,
  ButtonRow,
  Card,
  EmptyState,
  Mascot,
  Page,
  ParentCodeSheet,
  Spinner,
  Txt,
  haptic,
} from "../../ui/kit";
import { useTheme } from "../../ui/theme";

export function ageOf(createdAt: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - createdAt) / 60_000);
  if (minutes < 1) return "Just now";
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

export function countSentence(count: number): string {
  if (count === 0) return "Nothing needs you right now.";
  return count === 1 ? "1 request needs a grown-up." : `${count} requests need a grown-up.`;
}

function RequestCard(props: { readonly waiting: WaitingRequest; readonly showMac: boolean }) {
  const theme = useTheme();
  const { refresh } = useMacData();
  const { mac, request, child } = props.waiting;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const name = child?.name ?? "A child";
  const heading = requestHeading(request);
  const where = [
    props.showMac ? mac.macName : null,
    request.projectTitle,
    request.threadTitle,
    ageOf(request.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  const settle = (sentence: string) => {
    setDone(sentence);
    setTimeout(() => void refresh(mac.macId), 1_200);
  };

  const decline = async () => {
    setBusy(true);
    setProblem(null);
    const result = await familyApi.answerRequest(mac.transport, {
      threadId: request.threadId,
      requestId: request.requestId,
      decision: "decline",
      fingerprint: request.fingerprint,
      proof: null,
    });
    setBusy(false);
    if (result.ok) settle("Declined. They see that on their screen.");
    else setProblem(result.message);
  };

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        {child ? <Avatar person={child} size={44} /> : null}
        <View style={{ flex: 1 }}>
          <Txt variant="headline">{`${name} needs a grown-up`}</Txt>
          <Txt variant="footnote" tone="label2" numberOfLines={2}>
            {where}
          </Txt>
        </View>
      </View>
      <Txt variant="title3">{heading}</Txt>
      {request.what.length > 0 ? (
        <View style={{ backgroundColor: theme.color.fill, borderRadius: 8, padding: 10 }}>
          <Txt variant="subheadline" style={{ fontFamily: "Menlo" }} selectable>
            {request.what}
          </Txt>
        </View>
      ) : null}
      {request.why ? <Txt tone="label2">{request.why}</Txt> : null}
      {request.lapsed ? (
        <Banner tone="warning" text="This one is waiting on the Mac now. Answer it there." />
      ) : null}
      {problem ? <Banner tone="warning" text={problem} /> : null}
      {done ? (
        <Banner tone="success" text={done} />
      ) : request.lapsed ? null : (
        <ButtonRow>
          <Button
            title="Decline"
            kind="grey"
            busy={busy}
            onPress={decline}
            style={{ flex: 1 }}
            size="medium"
          />
          <Button
            title="Allow once"
            onPress={() => setAsking(true)}
            style={{ flex: 1 }}
            size="medium"
          />
        </ButtonRow>
      )}
      <ParentCodeSheet
        visible={asking}
        title="Allow this once?"
        description={`${name}'s conversation wants to ${heading.charAt(0).toLowerCase()}${heading.slice(1)}. Enter the parent code to allow it, this once.`}
        actionLabel="Allow once"
        onClose={() => setAsking(false)}
        onCode={async (code) => {
          const result = await familyApi.answerRequest(mac.transport, {
            threadId: request.threadId,
            requestId: request.requestId,
            decision: "accept",
            fingerprint: request.fingerprint,
            proof: { type: "code", code },
          });
          if (!result.ok) return result.message;
          setAsking(false);
          haptic("success");
          settle("Allowed, this once.");
          return null;
        }}
      />
    </Card>
  );
}

export function RequestsScreen() {
  const grownUp = useGrownUp();
  const count = grownUp.waiting.filter((waiting) => !waiting.request.lapsed).length;
  return (
    <Page>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingHorizontal: 20,
          paddingTop: 6,
        }}
      >
        <Mascot pose={count > 0 ? "ask-a-grown-up" : "hello"} size={64} />
        <View style={{ flex: 1 }}>
          <Txt variant="title2">{`Hi ${grownUp.name}`}</Txt>
          <Txt tone="label2">{countSentence(count)}</Txt>
        </View>
      </View>
      {!grownUp.loaded ? (
        <Spinner />
      ) : grownUp.waiting.length === 0 ? (
        <EmptyState
          symbol="checkmark.shield"
          title="All quiet"
          body="When a child's work needs a grown-up (the internet, an install, deleting files), it shows here. You can say yes once, or no."
        />
      ) : (
        <View style={{ gap: 14, marginHorizontal: 16, marginTop: 20 }}>
          {grownUp.waiting.map((waiting) => (
            <RequestCard
              key={`${waiting.mac.macId}:${waiting.request.requestId}`}
              waiting={waiting}
              showMac={grownUp.macs.length > 1}
            />
          ))}
        </View>
      )}
    </Page>
  );
}
