/**
 * Grown-up mode (iPhone first, iPad too): Requests, Children and This device, as Phase 1's
 * grown-up phone. It reads everything and answers through the Mac's approver routes; it can't
 * send messages, start conversations, change settings or open files.
 */
import { useGrownUp } from "./GrownUpContext";
import { useActivityMirror } from "../../activity/useActivityMirror";
import {
  ChildConversationsScreen,
  ChildrenScreen,
  childConversationsOptions,
} from "../../screens/grownup/Children";
import { RecapScreen, recapOptions } from "../../screens/grownup/Recap";
import { RequestsScreen } from "../../screens/grownup/Requests";
import { ThisDeviceScreen } from "../../screens/grownup/ThisDevice";
import {
  AboutRoute,
  DemoRoute,
  demoOptions,
  ConversationRoute,
  MacsRoute,
  PageRoute,
  conversationOptions,
  pageOptions,
} from "../screens";
import { Shell, type ShellScreen, type ShellSection } from "../Shell";

const SCREENS: ReadonlyArray<ShellScreen> = [
  { name: "Requests", component: RequestsScreen },
  { name: "Children", component: ChildrenScreen },
  { name: "ThisDevice", component: ThisDeviceScreen },
  {
    name: "ChildConversations",
    component: ChildConversationsScreen,
    options: childConversationsOptions,
  },
  { name: "Recap", component: RecapScreen, options: recapOptions },
  { name: "Conversation", component: ConversationRoute, options: conversationOptions as never },
  { name: "Page", component: PageRoute, options: pageOptions as never },
  { name: "Macs", component: MacsRoute, options: { title: "Linked Macs" } },
  { name: "About", component: AboutRoute, options: { title: "About SKYCOT" } },
  ...(__DEV__ ? [{ name: "Demo" as const, component: DemoRoute, options: demoOptions }] : []),
];

export function GrownUpApp() {
  const grownUp = useGrownUp();
  useActivityMirror();
  const count = grownUp.waiting.filter((waiting) => !waiting.request.lapsed).length;
  const sections: ReadonlyArray<ShellSection> = [
    {
      id: "requests",
      title: "Requests",
      symbol: "hand.raised",
      selectedSymbol: "hand.raised.fill",
      route: "Requests",
      ...(count > 0 ? { badge: String(count) } : {}),
    },
    {
      id: "children",
      title: "Children",
      symbol: "figure.2.and.child.holdinghands",
      route: "Children",
    },
    { id: "device", title: "This device", symbol: "iphone", route: "ThisDevice" },
  ];
  return (
    <Shell
      sections={sections}
      screens={SCREENS}
      sidebarTitle="SKYCOT"
      sidebarSubtitle={grownUp.macs[0]?.me.deviceName ?? "A grown-up's device"}
      sidebarItemsTitle="Waiting"
      sidebarItems={grownUp.waiting.slice(0, 12).map((waiting) => ({
        key: `${waiting.mac.macId}:${waiting.request.requestId}`,
        title: `${waiting.child?.name ?? "A child"} needs a grown-up`,
        subtitle: waiting.request.threadTitle,
        symbol: "hand.raised.fill",
        open: {
          name: "Conversation",
          params: {
            macId: waiting.mac.macId,
            threadId: waiting.request.threadId,
            title: waiting.request.threadTitle,
            readOnly: true,
          },
          title: waiting.request.threadTitle,
        },
      }))}
    />
  );
}
