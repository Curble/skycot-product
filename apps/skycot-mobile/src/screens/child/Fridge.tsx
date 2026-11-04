/**
 * The family fridge on a child's device: their own magnets and anything pinned by anyone
 * (the engine decides which). Pin to the fridge and Take it down never delete anything.
 */
// nondev-seam: skycot-iphone-q50-fridge-mobile
// nondev-seam: skycot-q51-fridge-svg-mobile
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { WebView } from "react-native-webview";

import {
  childFridgeTitle,
  fridgeIcon,
  fridgeKindLabel,
  fridgeOrder,
  madeLabel,
  mayPinMagnet,
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
  ChildLoading,
  EmptyState,
  Page,
  Section,
  Symbol,
  Txt,
  haptic,
} from "../../ui/kit";
import { useGridBasis } from "../../ui/layout";
import { useTheme } from "../../ui/theme";
import { createCardCache } from "./fridgeCards";

// Cards already fetched, kept by hash for this run of the app (bounded).
const cardCache = createCardCache();

/**
 * The engine's drawn card for a page, or null while loading, on failure, or when the Mac is
 * older and sends no card (the caller then shows the per-kind icon). A changed hash refetches.
 */
function useCardSvg(mac: Mac, hash: string | undefined): string | null {
  const [svg, setSvg] = useState<string | null>(hash === undefined ? null : cardCache.peek(hash));
  useEffect(() => {
    if (hash === undefined) {
      setSvg(null);
      return;
    }
    const kept = cardCache.peek(hash);
    setSvg(kept);
    if (kept !== null) return;
    let live = true;
    void cardCache
      .load(hash, (name) => familyApi.fridgeCard(mac.transport, name))
      .then((text) => {
        if (live) setSvg(text);
      });
    return () => {
      live = false;
    };
  }, [mac.transport, hash]);
  return svg;
}

// nondev-seam: skycot-fridge-picture-mobile
// Real page pictures (as image addresses), kept by hash like the cards (bounded).
const pictureCache = createCardCache();

/** The real picture of a page, or null while loading, on failure, or when there is none. */
function usePicture(mac: Mac, hash: string | undefined, wanted: boolean): string | null {
  const key = wanted ? hash : undefined;
  const [uri, setUri] = useState<string | null>(key === undefined ? null : pictureCache.peek(key));
  useEffect(() => {
    if (key === undefined) {
      setUri(null);
      return;
    }
    const kept = pictureCache.peek(key);
    setUri(kept);
    if (kept !== null) return;
    let live = true;
    void pictureCache
      .load(key, (name) => familyApi.fridgePicture(mac.transport, name))
      .then((found) => {
        if (live) setUri(found);
      });
    return () => {
      live = false;
    };
  }, [mac.transport, key]);
  return uri;
}

const MAGNET_COLORS = ["#F26B4E", "#3A9DF6", "#3FA66F", "#8E5AA8", "#E8A50C", "#E0603F"];

function Magnet(props: {
  readonly item: FridgeItem;
  readonly mac: Mac;
  readonly index: number;
  readonly childName: string | null;
  readonly onOpen: () => void;
  readonly onPin?: (pinned: boolean) => void;
  readonly compact?: boolean;
}) {
  const color = MAGNET_COLORS[props.index % MAGNET_COLORS.length]!;
  const grid = useGridBasis();
  const card = useCardSvg(props.mac, props.item.cardHash);
  const picture = usePicture(props.mac, props.item.cardHash, props.item.hasPicture === true);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${friendlyTitle(childFridgeTitle(props.item, props.childName))}`}
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
        <View style={{ height: props.compact ? 70 : 110, backgroundColor: color }}>
          {picture !== null ? (
            // The page as the child made it: a real picture, filling the same frame.
            <Image
              source={{ uri: picture }}
              resizeMode="cover"
              accessibilityElementsHidden
              style={{ width: "100%", height: "100%" }}
            />
          ) : card !== null ? (
            // The engine's static card, drawn as a picture (never through a web view).
            <SvgXml xml={card} width="100%" height="100%" pointerEvents="none" />
          ) : props.item.thumbnailSvg ? (
            <WebView
              source={{ html: props.item.thumbnailSvg }}
              javaScriptEnabled={false}
              domStorageEnabled={false}
              scrollEnabled={false}
              pointerEvents="none"
              originWhitelist={["about:blank"]}
              style={{ flex: 1, backgroundColor: "transparent" }}
            />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Symbol
                name={fridgeIcon(props.item.title, props.item.page)}
                size={props.compact ? 28 : 40}
                color="#FFFFFF"
              />
            </View>
          )}
          {props.item.pinnedAt !== null ? (
            <View style={{ position: "absolute", top: 8, right: 8 }}>
              <Symbol name="pin.fill" size={16} color="#FFFFFF" />
            </View>
          ) : null}
        </View>
        <View style={{ padding: 10, gap: 2 }}>
          <Txt variant="subheadline" weight="600" numberOfLines={2}>
            {friendlyTitle(childFridgeTitle(props.item, props.childName))}
          </Txt>
          <Txt variant="caption" tone="label2">
            {fridgeKindLabel(props.item.title, props.item.page)} ·{" "}
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

function MacFridge(props: {
  readonly mac: Mac;
  readonly showName: boolean;
  readonly childName: string | null;
}) {
  const fridge = useFamilyRead(props.mac, readFridge, 30_000, "fridge");
  const open = useOpenPage();
  const [, setTick] = useState(0);
  const items = fridge.value === null ? [] : fridgeOrder(fridge.value);
  if (fridge.loading) return <ChildLoading onRetry={() => void fridge.refresh()} />;
  if (fridge.problem && fridge.value === null) {
    return (
      <Page>
        <EmptyState title="That didn't work just now.">
          <Button title="Try again" onPress={() => void fridge.refresh()} />
        </EmptyState>
      </Page>
    );
  }
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
            key={`${item.threadId}:${item.contentHash ?? ""}`}
            item={item}
            mac={props.mac}
            index={index}
            childName={props.childName}
            onOpen={() => open(props.mac, item)}
            // A child changes only their own magnets (the engine refuses a sibling's), so a
            // sibling's pinned page has no "Take it down" here.
            {...(mayPinMagnet(
              item,
              props.mac.me.kind === "child" ? { childId: props.mac.me.childId } : null,
            )
              ? {
                  onPin: async (pinned: boolean) => {
                    await familyApi.pin(props.mac.transport, item.threadId, pinned);
                    await fridge.refresh();
                    setTick((tick) => tick + 1);
                  },
                }
              : {})}
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
        <MacFridge
          key={mac.macId}
          mac={mac}
          showName={child.macs.length > 1}
          childName={child.name}
        />
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
              key={`${item.threadId}:${item.contentHash ?? ""}`}
              item={item}
              mac={mac}
              index={index}
              childName={child.name}
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
