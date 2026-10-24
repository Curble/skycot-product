/**
 * Requests: every "Ask a grown-up" waiting on any linked Mac. Allow once (Face ID when it is set
 * up on this phone, src/faceid; the parent code otherwise, or when Face ID is cancelled or
 * fails) or Decline; never "for the session" or "always". The Mac checks the request, the
 * card's fingerprint and the proof every time, and logs who said yes and how (Phase 1's
 * approver routes).
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import {
  grownUpRequestSentence,
  requestHeading,
} from "../../../../nondev/src/features/family/people";
import type { StackRoutes } from "../../app/routes";
import {
  useGrownUp,
  type WaitingFamilyNote,
  type WaitingRequest,
} from "../../app/grownup/GrownUpContext";
import { useCodeLength, useMacData } from "../../data/MacData";
import { subscribeAllow, takeAllow } from "../../faceid/allowIntent";
import { useFaceId } from "../../faceid/FaceIdProvider";
import { familyApi } from "../../family/api";
import { shownNoteTarget } from "../../family/noteTarget";
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

function FamilyNoteCard({ item }: { readonly item: WaitingFamilyNote }) {
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const { refresh } = useMacData();
  const codeLength = useCodeLength(item.mac.macId);
  const [minutes, setMinutes] = useState<0 | 15 | 30 | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = item.child?.name ?? "A child";
  const note = item.note;
  const settle = async (
    value: 0 | 15 | 30,
    proof?: { readonly type: "code"; readonly code: string },
  ) => {
    setBusy(true);
    const result =
      note.kind === "shown" && value === 0
        ? await familyApi.seenFamilyNote(item.mac.transport, note.id)
        : await familyApi.answerFamilyNote(item.mac.transport, {
            id: note.id,
            minutes: value,
            ...(proof ? { proof } : {}),
          });
    setBusy(false);
    if (result.ok) {
      setMinutes(null);
      void refresh(item.mac.macId);
    } else setProblem(result.message);
  };
  // "Open it": what they made, inside SKYCOT, then the note is marked seen.
  const openIt = async () => {
    setBusy(true);
    setProblem(null);
    const fridge = await familyApi.fridge(item.mac.transport);
    const target = shownNoteTarget(item.mac.macId, note, fridge.ok ? fridge.value : null);
    if (target === null) {
      setBusy(false);
      setProblem("That one can't be opened here. Have a look on the Mac.");
      return;
    }
    if (target.name === "Page") navigation.navigate("Page", target.params);
    else navigation.navigate("Conversation", target.params);
    await familyApi.seenFamilyNote(item.mac.transport, note.id);
    setBusy(false);
    void refresh(item.mac.macId);
  };
  return (
    <Card style={{ gap: 10 }}>
      <Txt variant="headline">
        {note.kind === "shown"
          ? `${name} made something. Have a look`
          : `${name} asked for more time`}
      </Txt>
      {note.kind === "shown" ? <Txt variant="subheadline">{note.title}</Txt> : null}
      {problem ? <Banner tone="warning" text={problem} /> : null}
      {note.kind === "shown" ? (
        <ButtonRow minWidthEach={95}>
          <Button
            title="Open it"
            kind="filled"
            busy={busy}
            onPress={() => void openIt()}
            style={{ flex: 1 }}
          />
          <Button
            title="Seen"
            kind="grey"
            busy={busy}
            onPress={() => void settle(0)}
            style={{ flex: 1 }}
          />
        </ButtonRow>
      ) : (
        <ButtonRow minWidthEach={95}>
          <Button
            title="15 min"
            kind="grey"
            busy={busy}
            onPress={() => setMinutes(15)}
            style={{ flex: 1 }}
          />
          <Button
            title="30 min"
            kind="grey"
            busy={busy}
            onPress={() => setMinutes(30)}
            style={{ flex: 1 }}
          />
          <Button
            title="Not tonight"
            kind="grey"
            busy={busy}
            onPress={() => void settle(0)}
            style={{ flex: 1 }}
          />
        </ButtonRow>
      )}
      <ParentCodeSheet
        visible={minutes !== null}
        title="Give more time?"
        description={`Enter the parent code to give ${name} ${minutes ?? ""} more minutes.`}
        actionLabel="Give more time"
        length={codeLength}
        onClose={() => setMinutes(null)}
        onCode={async (code) => {
          const chosen = minutes;
          if (chosen === null) return null;
          const result = await familyApi.answerFamilyNote(item.mac.transport, {
            id: note.id,
            minutes: chosen,
            proof: { type: "code", code },
          });
          if (!result.ok) return result.message;
          setMinutes(null);
          void refresh(item.mac.macId);
          return null;
        }}
      />
    </Card>
  );
}

function RequestCard(props: {
  readonly waiting: WaitingRequest;
  readonly showMac: boolean;
  /** Every request waiting now ("<macId>:<requestId>"), for a notification's Allow once. */
  readonly liveKeys: ReadonlyArray<string>;
}) {
  const theme = useTheme();
  const { refresh } = useMacData();
  const faceId = useFaceId();
  const { mac, request, child } = props.waiting;
  const codeLength = useCodeLength(mac.macId);
  const [asking, setAsking] = useState(false);
  /** Why the code is asked for, when Face ID was tried and didn't say yes. */
  const [codeNote, setCodeNote] = useState<string | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
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

  const settle = useCallback(
    (sentence: string) => {
      setDone(sentence);
      setTimeout(() => void refresh(mac.macId), 1_200);
    },
    [refresh, mac.macId],
  );

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

  const useFace = faceId.readyOn(mac);
  const allowingRef = useRef(false);
  /** Allow once: Face ID's fresh signature when it is set up; the parent code otherwise. */
  const allow = async () => {
    if (allowingRef.current || done !== null || request.lapsed) return;
    setProblem(null);
    setCodeNote(null);
    if (!faceId.readyOn(mac)) {
      setAsking(true);
      return;
    }
    allowingRef.current = true;
    setAllowing(true);
    try {
      const outcome = await faceId.allow(mac, request, child?.name ?? null);
      if (outcome.kind === "allowed") {
        haptic("success");
        settle(`Allowed with ${faceId.label}, this once.`);
      } else if (outcome.kind === "use-code") {
        setCodeNote(outcome.note);
        setAsking(true);
      } else {
        setProblem(outcome.message);
      }
    } finally {
      allowingRef.current = false;
      setAllowing(false);
    }
  };
  const allowRef = useRef(allow);
  useEffect(() => {
    allowRef.current = allow;
  }, [allow]);

  // "Allow once" on this card's notification: Face ID starts here, with the card on screen.
  const key = `${mac.macId}:${request.requestId}`;
  const liveKeysRef = useRef(props.liveKeys);
  useEffect(() => {
    liveKeysRef.current = props.liveKeys;
  }, [props.liveKeys]);
  useEffect(() => {
    const check = () => {
      if (takeAllow(key, liveKeysRef.current)) void allowRef.current();
    };
    check();
    return subscribeAllow(check);
  }, [key]);

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
      {/* nondev-seam: skycot-grownup-request-sentence */}
      <Txt variant="title3">{grownUpRequestSentence(request, name)}</Txt>
      <Button
        title={showDetails ? "Hide details" : "Show details"}
        kind="plain"
        onPress={() => setShowDetails((value) => !value)}
      />
      {showDetails && request.what.length > 0 ? (
        <View style={{ backgroundColor: theme.color.fill, borderRadius: 8, padding: 10 }}>
          <Txt variant="subheadline" style={{ fontFamily: "Menlo" }} selectable>
            {request.what}
          </Txt>
        </View>
      ) : null}
      {showDetails && request.why ? <Txt tone="label2">{request.why}</Txt> : null}
      {request.lapsed ? (
        <Banner tone="warning" text="This one is waiting on the Mac now. Answer it there." />
      ) : null}
      {problem ? <Banner tone="warning" text={problem} /> : null}
      {done ? (
        <Banner tone="success" text={done} />
      ) : request.lapsed ? null : (
        <ButtonRow minWidthEach={120}>
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
            {...(useFace
              ? { icon: "faceid" as const, accessibilityLabel: `Allow once with ${faceId.label}` }
              : {})}
            busy={allowing}
            onPress={() => void allow()}
            style={{ flex: 1 }}
            size="medium"
          />
        </ButtonRow>
      )}
      <ParentCodeSheet
        visible={asking}
        title="Allow this once?"
        description={`${codeNote === null ? "" : `${codeNote}\n\n`}${name}'s conversation wants to ${heading.charAt(0).toLowerCase()}${heading.slice(1)}. Enter the parent code to allow it, this once.`}
        actionLabel="Allow once"
        length={codeLength}
        onClose={() => {
          setAsking(false);
          setCodeNote(null);
        }}
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
  const live = grownUp.waiting.filter((waiting) => !waiting.request.lapsed);
  const count = live.length;
  const liveKeys = live.map((waiting) => `${waiting.mac.macId}:${waiting.request.requestId}`);
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
      ) : grownUp.waiting.length === 0 && grownUp.notes.length === 0 ? (
        <EmptyState
          symbol="checkmark.shield"
          title="All quiet"
          body="When a child's work needs a grown-up (the internet, an install, deleting files), it shows here. You can say yes once, or no."
        />
      ) : (
        <View style={{ gap: 14, marginHorizontal: 16, marginTop: 20 }}>
          {grownUp.notes.map((item) => (
            <FamilyNoteCard key={`${item.mac.macId}:${item.note.id}`} item={item} />
          ))}
          {grownUp.waiting.map((waiting) => (
            <RequestCard
              key={`${waiting.mac.macId}:${waiting.request.requestId}`}
              waiting={waiting}
              showMac={grownUp.macs.length > 1}
              liveKeys={liveKeys}
            />
          ))}
        </View>
      )}
    </Page>
  );
}
