// nondev-seam: skycot-ipad-grownup-recap
/**
 * "Ava's week" (or today): what they made, what they asked for, what needed a grown-up and the
 * time used, built by the Mac from what it already keeps. Open on a grown-up's phone without
 * the code (Phase 1). The words are the plain client's (features/recap/recap.ts).
 */
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { View } from "react-native";

import {
  askLine,
  grownUpLines,
  madeSummary,
  minutesPhrase,
  rangeLabel,
  recapHeadline,
  weekBars,
  type RecapRange,
} from "../../../../nondev/src/features/recap/recap";
import { childLabel } from "../../../../nondev/src/features/family/children";
import { friendlyTitle } from "../../../../nondev/src/plain/titles";
import type { StackRoutes } from "../../app/routes";
import { useGrownUp } from "../../app/grownup/GrownUpContext";
import { useFamilyRead } from "../../data/hooks";
import { useMacData } from "../../data/MacData";
import { familyApi } from "../../family/api";
import { useLinks } from "../../links/store";
import {
  Banner,
  Card,
  EmptyState,
  Page,
  Row,
  Section,
  Segmented,
  Spinner,
  Txt,
} from "../../ui/kit";
import { useTheme } from "../../ui/theme";

export function RecapScreen() {
  const theme = useTheme();
  const route = useRoute<RouteProp<StackRoutes, "Recap">>();
  const { macs } = useLinks();
  const { byMac } = useMacData();
  const mac = macs.find((candidate) => candidate.macId === route.params.macId) ?? null;
  const child = mac
    ? (byMac[mac.macId]?.status?.children.find((c) => c.id === route.params.childId) ?? null)
    : null;
  const name = child?.name ?? "Your child";
  const [range, setRange] = useState<RecapRange>("week");
  const report = useFamilyRead(
    mac,
    (target) => familyApi.recap(target.transport, route.params.childId, range),
    null,
    `recap:${route.params.childId}:${range}`,
  );
  const value = report.value;
  const bars = value ? weekBars(value.days) : [];
  const tallest = Math.max(1, ...bars.map((bar) => bar.minutes));

  return (
    <Page>
      <View style={{ marginHorizontal: 16, marginTop: 8 }}>
        <Segmented
          accessibilityLabel="Which recap"
          options={[
            { id: "week", label: "This week" },
            { id: "session", label: "Today" },
          ]}
          value={range}
          onChange={setRange}
        />
      </View>
      {report.loading ? <Spinner /> : null}
      {report.problem ? (
        <View style={{ margin: 16 }}>
          <Banner tone="warning" text={report.problem} />
        </View>
      ) : null}
      {value ? (
        <View style={{ gap: 14, margin: 16 }}>
          <Txt variant="title2">{recapHeadline(value, name)}</Txt>
          <Txt tone="label2">{rangeLabel(value)}</Txt>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Stat value={minutesPhrase(value.minutes)} label="on SKYCOT" />
            <Stat
              value={String(value.made.length)}
              label={value.made.length === 1 ? "thing made" : "things made"}
            />
            <Stat
              value={String(value.messages)}
              label={value.messages === 1 ? "message" : "messages"}
            />
          </View>
          {range === "week" && bars.length > 0 ? (
            <Card>
              <Txt variant="headline">Time used</Txt>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 8,
                  height: 110,
                  marginTop: 12,
                }}
              >
                {bars.map((bar) => (
                  <View key={bar.date} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                    <View
                      style={{
                        width: "70%",
                        height: Math.max(3, (bar.minutes / tallest) * 80),
                        borderRadius: 4,
                        backgroundColor: theme.color.accent,
                      }}
                    />
                    <Txt variant="caption" tone="label2">
                      {bar.label}
                    </Txt>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
          {value.proudOf ? (
            <Card>
              <Txt variant="footnote" tone="label2" style={{ textTransform: "uppercase" }}>
                Most proud of
              </Txt>
              <Txt variant="title3">{friendlyTitle(value.proudOf.title)}</Txt>
            </Card>
          ) : null}
          <Card style={{ gap: 8 }}>
            <Txt variant="headline">{`What ${name} made`}</Txt>
            {value.made.length === 0 ? <Txt tone="label2">Nothing yet.</Txt> : null}
            {value.made.map((made) => (
              <View key={made.threadId}>
                <Txt weight="600">{friendlyTitle(made.title)}</Txt>
                {madeSummary(made) ? (
                  <Txt variant="subheadline" tone="label2">
                    {madeSummary(made)}
                  </Txt>
                ) : null}
              </View>
            ))}
          </Card>
          <Card style={{ gap: 6 }}>
            <Txt variant="headline">{`What ${name} asked for`}</Txt>
            {value.asks.length === 0 ? <Txt tone="label2">No messages.</Txt> : null}
            {value.asks.slice(0, 12).map((ask, index) => (
              <Txt key={`${ask.threadId}:${index}`} variant="subheadline">
                {`“${askLine(ask)}”`}
              </Txt>
            ))}
          </Card>
          <Card style={{ gap: 6 }}>
            <Txt variant="headline">What needed a grown-up</Txt>
            {grownUpLines(value).length === 0 ? (
              <Txt tone="label2">Nothing needed a grown-up.</Txt>
            ) : null}
            {grownUpLines(value).map((line, index) => (
              <Txt key={index} variant="subheadline">
                {`• ${line}`}
              </Txt>
            ))}
          </Card>
        </View>
      ) : null}
    </Page>
  );
}

export function RecapHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const grownUp = useGrownUp();
  const several = grownUp.macs.length > 1;
  return (
    <Page>
      {grownUp.macs.map((mac) => {
        const children = grownUp.childrenOn(mac);
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
            ) : (
              <Section>
                {children.map((child, index) => {
                  const name = childLabel(child, index);
                  return (
                    <Row
                      key={child.id}
                      title={`${name}'s week`}
                      subtitle="What they made, asked for and needed help with."
                      chevron
                      onPress={() =>
                        navigation.navigate("Recap", { macId: mac.macId, childId: child.id })
                      }
                    />
                  );
                })}
              </Section>
            )}
          </View>
        );
      })}
    </Page>
  );
}

function Stat(props: { readonly value: string; readonly label: string }) {
  return (
    <Card style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Txt variant="title3" center>
        {props.value}
      </Txt>
      <Txt variant="caption" tone="label2" center>
        {props.label}
      </Txt>
    </Card>
  );
}

export const recapOptions = () => ({ title: "Recap" });
