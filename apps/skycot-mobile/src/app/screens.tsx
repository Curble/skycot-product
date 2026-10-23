/**
 * Route wrappers shared by both modes: they read the route's params, find the Mac, and render
 * the screen. Kept apart from the screens so a screen never knows about navigation params.
 */
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useMemo } from "react";
import { View } from "react-native";

import { friendlyTitle } from "../../../nondev/src/plain/titles";
import { demoConversation } from "../dev/demoConversation";
import { readFridge, useFamilyRead } from "../data/hooks";
import { useOptionalChild } from "./child/ChildContext";
import { useLinks } from "../links/store";
import { ConversationView } from "../screens/conversation/ConversationView";
import { AboutContent } from "../screens/shared/About";
import { MacsScreen } from "../screens/shared/Macs";
import { PagePreview } from "../screens/shared/PagePreview";
import { Banner, Page } from "../ui/kit";
import { HeaderButton } from "./Shell";
import type { StackRoutes } from "./routes";

function useMac(macId: string) {
  return useLinks().macs.find((mac) => mac.macId === macId) ?? null;
}

function Gone() {
  return (
    <View style={{ padding: 20 }}>
      <Banner tone="warning" text="This Mac isn't linked to this device any more." />
    </View>
  );
}

export function ConversationRoute() {
  const route = useRoute<RouteProp<StackRoutes, "Conversation">>();
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const { macId, threadId, readOnly } = route.params;
  const mac = useMac(macId);
  const { mode } = useLinks();
  const child = useOptionalChild();
  const fridge = useFamilyRead(
    mac,
    mode === "child" ? readFridge : null,
    10_000,
    `fridge:${threadId}`,
  );
  const page = fridge.value?.find((item) => item.threadId === threadId) ?? null;
  const setTitle = useCallback((title: string) => navigation.setOptions({ title }), [navigation]);
  if (mac === null) return <Gone />;
  const childId = mac.me.kind === "child" ? mac.me.childId : null;
  return (
    <ConversationView
      mac={mac}
      threadId={threadId}
      readOnly={readOnly === true || mode !== "child"}
      childId={childId}
      onTitle={setTitle}
      voiceAllowed={child !== null && child.childOn(mac)?.voice.typing === true}
      {...(page
        ? {
            onOpenPage: () =>
              navigation.navigate("Page", {
                macId,
                threadId,
                page: page.page,
                title: friendlyTitle(page.title),
              }),
          }
        : {})}
    />
  );
}

export const conversationOptions = (params: StackRoutes["Conversation"]) => ({
  title: params.title,
  headerLargeTitle: false,
});

export function PageRoute() {
  const route = useRoute<RouteProp<StackRoutes, "Page">>();
  const mac = useMac(route.params.macId);
  if (mac === null) return <Gone />;
  return <PagePreview mac={mac} threadId={route.params.threadId} page={route.params.page} />;
}

export const pageOptions = (params: StackRoutes["Page"]) => ({
  title: params.title,
  presentation: "modal" as const,
  headerLargeTitle: false,
});

export function AboutRoute() {
  return (
    <Page>
      <AboutContent />
    </Page>
  );
}

export function MacsRoute() {
  return <MacsScreen />;
}

/** The ⓘ at the top right of every main screen: linked Macs and About. */
export function MacsHeaderButton() {
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  return (
    <HeaderButton
      symbol="info.circle"
      label="This device and About"
      onPress={() => navigation.navigate("Macs")}
    />
  );
}

/** Development builds: a demo conversation (src/dev/demoConversation.ts). */
export function DemoRoute() {
  const route = useRoute<RouteProp<StackRoutes, "Demo">>();
  const mac = useLinks().macs[0] ?? null;
  const demo = useMemo(() => demoConversation(route.params.name), [route.params.name]);
  if (mac === null) return <Gone />;
  return (
    <ConversationView
      mac={mac}
      threadId={demo.thread.id}
      readOnly={mac.me.kind !== "child"}
      demo={demo}
      {...(route.params.name === "made" ? { onOpenPage: () => undefined } : {})}
    />
  );
}

export const demoOptions = () => ({ title: "Make a space game", headerLargeTitle: false });
