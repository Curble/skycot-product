/**
 * The family fridge on a child's device: their own magnets and anything pinned by anyone
 * (the engine decides which). Pin to the fridge and Take it down never delete anything.
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, View } from "react-native";

import {
  fridgeOrder,
  madeLabel,
  type FridgeItem,
} from "../../../../nondev/src/features/fridge/fridge";
import { friendlyTitle } from "../../../../nondev/src/plain/titles";
import type { StackRoutes } from "../../app/routes";
import { useChild } from "../../app/child/ChildContext";
import { familyApi } from "../../family/api";
import { readFridge, useFamilyRead } from "../../data/hooks";
import type { Mac } from "../../links/store";
import {
  Button,
  Card,
  EmptyState,
  Page,
  Section,
  Spinner,
  Symbol,
  Txt,
  haptic,
} from "../../ui/kit";
import { useGridBasis } from "../../ui/layout";
import { useTheme } from "../../ui/theme";

const MAGNET_COLORS = ["#F26B4E", "#3A9DF6", "#3FA66F", "#8E5AA8", "#E8A50C", "#E0603F"];

function Magnet(props: {
  readonly item: FridgeItem;
  readonly mac: Mac;
  readonly index: number;
  readonly onOpen: () => void;
  readonly onPin?: (pinned: boolean) => void;
  readonly compact?: boolean;
}) {
  const color = MAGNET_COLORS[props.index % MAGNET_COLORS.length]!;
  const grid = useGridBasis();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${friendlyTitle(props.item.title)}`}
      onPress={() => {
        haptic();
        props.onOpen();
      }}
      style={({ pressed }) => ({
        flexBasis: props.compact ? "30%" : grid,
        flexGrow: 1,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Card padded={false} style={{ overflow: "hidden" }}>
        <View
          style={{
            height: props.compact ? 70 : 110,
            backgroundColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Symbol name="doc.richtext.fill" size={props.compact ? 28 : 40} color="#FFFFFF" />
          {props.item.pinnedAt !== null ? (
            <View style={{ position: "absolute", top: 8, right: 8 }}>
              <Symbol name="pin.fill" size={16} color="#FFFFFF" />
            </View>
          ) : null}
        </View>
        <View style={{ padding: 10, gap: 2 }}>
          <Txt variant="subheadline" weight="600" numberOfLines={2}>
            {friendlyTitle(props.item.title)}
          </Txt>
          <Txt variant="caption" tone="label2">
            {madeLabel(props.item.madeAt, Date.now())}
          </Txt>
          {props.onPin ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onPin?.(props.item.pinnedAt === null)}
              hitSlop={6}
              style={{ marginTop: 6 }}
            >
              <Txt variant="footnote" tone="accent">
                {props.item.pinnedAt === null ? "Pin to the fridge" : "Take it down"}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

function useOpenPage() {
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  return (mac: Mac, item: FridgeItem) =>
    navigation.navigate("Page", {
      macId: mac.macId,
      threadId: item.threadId,
      page: item.page,
      title: friendlyTitle(item.title),
    });
}

function MacFridge(props: { readonly mac: Mac; readonly showName: boolean }) {
  const fridge = useFamilyRead(props.mac, readFridge, 30_000, "fridge");
  const open = useOpenPage();
  const [, setTick] = useState(0);
  const items = fridge.value === null ? [] : fridgeOrder(fridge.value);
  if (fridge.loading) return <Spinner />;
  if (items.length === 0) {
    return props.showName ? null : (
      <EmptyState
        pose="thinking"
        title="Nothing on the fridge yet"
        body="When a conversation makes a page (a game, a card, a poster), it shows up here."
      />
    );
  }
  return (
    <View style={{ marginTop: 18 }}>
      {props.showName ? (
        <Txt
          variant="footnote"
          tone="label2"
          style={{ textTransform: "uppercase", marginHorizontal: 32, marginBottom: 8 }}
        >
          {props.mac.macName}
        </Txt>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginHorizontal: 16 }}>
        {items.map((item, index) => (
          <Magnet
            key={item.threadId}
            item={item}
            mac={props.mac}
            index={index}
            onOpen={() => open(props.mac, item)}
            onPin={async (pinned) => {
              await familyApi.pin(props.mac.transport, item.threadId, pinned);
              await fridge.refresh();
              setTick((tick) => tick + 1);
            }}
          />
        ))}
      </View>
    </View>
  );
}

export function FridgeScreen() {
  const child = useChild();
  return (
    <Page>
      <Txt variant="subheadline" tone="label2" style={{ marginHorizontal: 20, marginTop: 4 }}>
        Everything you made, and the best ones anyone pinned up. Taking one down never deletes it.
      </Txt>
      {child.macs.map((mac) => (
        <MacFridge key={mac.macId} mac={mac} showName={child.macs.length > 1} />
      ))}
    </Page>
  );
}

/** "On the fridge" on Home: up to three magnets from the first Mac that has any. */
export function FridgeTile(props: { readonly onSeeAll: () => void }) {
  const child = useChild();
  const mac = child.macs[0] ?? null;
  const fridge = useFamilyRead(mac, readFridge, 60_000, "fridge-tile");
  const open = useOpenPage();
  const items = fridge.value === null ? [] : fridgeOrder(fridge.value).slice(0, 3);
  if (mac === null || items.length === 0) return null;
  return (
    <Section title="On the fridge">
      <View style={{ padding: 12, gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {items.map((item, index) => (
            <Magnet
              key={item.threadId}
              item={item}
              mac={mac}
              index={index}
              compact
              onOpen={() => open(mac, item)}
            />
          ))}
        </View>
        <Button title="See the whole fridge" kind="plain" size="small" onPress={props.onSeeAll} />
      </View>
    </Section>
  );
}
