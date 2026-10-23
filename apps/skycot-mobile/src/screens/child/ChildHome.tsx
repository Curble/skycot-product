/**
 * A child's Home: the greeting, "What shall we make?" starter cards, Just ask, their own
 * conversations (from every linked Mac, each labelled by its Mac when there are several), and
 * the fridge. Copy and starters are the plain client's (features/starters, home).
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, View } from "react-native";

import {
  KID_STARTERS,
  type Starter,
  type StarterIcon,
  type StarterTone,
} from "../../../../nondev/src/features/starters/starters";
import { JUST_ASK_COPY } from "../../../../nondev/src/features/questions/questions";
import { headsUpSentence } from "../../../../nondev/src/features/family-limits/limits";
import type { StackRoutes } from "../../app/routes";
import { useChild } from "../../app/child/ChildContext";
import { conversationRows, relativeTime, rowLabel, stateLabel } from "../../data/conversations";
import { useMacData } from "../../data/MacData";
import { BUILDER_NAME } from "../../ui/brand";
import { Banner, Card, Mascot, Row, Section, Symbol, Txt, haptic, Page } from "../../ui/kit";
import { useTheme } from "../../ui/theme";
import { FridgeTile } from "./Fridge";

const ICONS: Readonly<Partial<Record<StarterIcon, Parameters<typeof Symbol>[0]["name"]>>> = {
  game: "gamecontroller.fill",
  pet: "pawprint.fill",
  cake: "gift.fill",
  school: "book.fill",
  comic: "text.bubble.fill",
  quiz: "questionmark.bubble.fill",
  draw: "pencil.and.scribble",
  surprise: "sparkles",
};

export function toneColor(tone: StarterTone, dark: boolean): string {
  const light: Record<StarterTone, string> = {
    orange: "#F26B4E",
    blue: "#3A9DF6",
    green: "#3FA66F",
    purple: "#8E5AA8",
    red: "#E0603F",
    yellow: "#E8A50C",
  };
  const night: Record<StarterTone, string> = {
    orange: "#FF8A6C",
    blue: "#5FB0FF",
    green: "#5CC98D",
    purple: "#B07FD0",
    red: "#FF7A66",
    yellow: "#F2C14E",
  };
  return (dark ? night : light)[tone];
}

export function greetingFor(now: Date, name: string | null): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}${name ? `, ${name}` : ""}.`;
}

/** The kids' cards that work on a phone today (drawing needs a picture, which comes later). */
export const PHONE_STARTERS: ReadonlyArray<Starter> = KID_STARTERS.filter(
  (starter) => starter.kind !== "picture",
);

function StarterCard(props: { readonly starter: Starter; readonly onPress: () => void }) {
  const theme = useTheme();
  const color = toneColor(props.starter.tone, theme.dark);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.starter.title}. ${props.starter.blurb}`}
      onPress={() => {
        haptic();
        props.onPress();
      }}
      style={({ pressed }) => ({ flexBasis: "47%", flexGrow: 1, opacity: pressed ? 0.8 : 1 })}
    >
      <Card style={{ minHeight: 118, gap: 8 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            backgroundColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Symbol name={ICONS[props.starter.icon] ?? "sparkles"} size={20} color="#FFFFFF" />
        </View>
        <Txt variant="headline">{props.starter.title}</Txt>
        <Txt variant="footnote" tone="label2">
          {props.starter.blurb}
        </Txt>
      </Card>
    </Pressable>
  );
}

export function ChildHome() {
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const child = useChild();
  const { byMac } = useMacData();
  const rows = conversationRows(child.macs, byMac, child.questionsRoots);
  const several = child.macs.length > 1;
  const heads = child.macs
    .map((mac) => child.sessionOn(mac)?.limits)
    .map((limits) => (limits ? headsUpSentence(limits) : null))
    .find((sentence) => sentence !== null);
  const unreachable = child.macs.filter((mac) => byMac[mac.macId]?.reachable === false);

  return (
    <Page>
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Mascot pose="hello" size={72} />
        <View style={{ flex: 1 }}>
          <Txt variant="footnote" tone="label2">
            SKYCOT says hello
          </Txt>
          <Txt variant="title2">{greetingFor(new Date(), child.name)}</Txt>
        </View>
      </View>
      {heads ? (
        <View style={{ marginHorizontal: 16, marginTop: 14 }}>
          <Banner text={heads} />
        </View>
      ) : null}
      {unreachable.map((mac) => (
        <View key={mac.macId} style={{ marginHorizontal: 16, marginTop: 14 }}>
          <Banner
            tone="warning"
            text={`${mac.macName} isn't answering. Check it's awake and on the same Wi-Fi.`}
          />
        </View>
      ))}

      <View style={{ marginHorizontal: 16, marginTop: 22, gap: 4 }}>
        <Txt variant="title3">What shall we make?</Txt>
        <Txt variant="subheadline" tone="label2">
          Tap a card, change the words if you like, then press Send. {BUILDER_NAME} shows you a plan
          first.
        </Txt>
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 12,
          marginHorizontal: 16,
          marginTop: 12,
        }}
      >
        {PHONE_STARTERS.map((starter) => (
          <StarterCard
            key={starter.id}
            starter={starter}
            onPress={() => navigation.navigate("NewConversation", { starterId: starter.id })}
          />
        ))}
      </View>

      <Section>
        <Row
          leading={<Symbol name="questionmark.bubble.fill" size={24} />}
          title={JUST_ASK_COPY.choice}
          subtitle={JUST_ASK_COPY.footPhone}
          chevron
          onPress={() => navigation.navigate("NewConversation", { question: true })}
        />
        <Row
          leading={<Symbol name="square.and.pencil" size={24} />}
          title="Start from a blank page"
          subtitle="Say what you'd like to make, like telling a friend."
          chevron
          onPress={() => navigation.navigate("NewConversation", {})}
        />
      </Section>

      <Section
        title="My conversations"
        footer={rows.length === 0 ? "When you start a conversation, it shows here." : undefined}
      >
        {rows.slice(0, 12).map((row) => (
          <Row
            key={row.key}
            title={row.thread.title}
            subtitle={[
              rowLabel(row, several),
              stateLabel(row.state, BUILDER_NAME) ?? relativeTime(row.updatedAt),
            ].join(" · ")}
            leading={
              <Symbol
                name={
                  row.state === "waiting"
                    ? "hand.raised.fill"
                    : row.state === "working"
                      ? "hammer.fill"
                      : "bubble.left.fill"
                }
                size={22}
              />
            }
            chevron
            onPress={() =>
              navigation.navigate("Conversation", {
                macId: row.mac.macId,
                threadId: row.thread.id,
                title: row.thread.title,
              })
            }
          />
        ))}
      </Section>

      <FridgeTile onSeeAll={() => navigation.navigate("Fridge")} />
    </Page>
  );
}
