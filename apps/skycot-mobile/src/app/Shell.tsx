/**
 * The app's frame, the same for both modes: a tab bar on iPhone (the system's own, through
 * react-native-screens' native tabs, as T3's app does), and on iPad a sidebar beside the
 * content, chosen with T3's layout breakpoints (src/ui/layout.ts). Each tab, and the iPad's
 * content pane, is its own push stack with large titles and standard back buttons.
 */
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationIndependentTree,
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
  type Theme as NavigationTheme,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import { Tabs, type TabSelectedEvent, type TabSelectionRejectedEvent } from "react-native-screens";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDeepLink } from "../links/deepLinks";
import type { StackRouteName, StackRoutes } from "./routes";
import { Symbol, Txt, haptic } from "../ui/kit";
import { useLayout } from "../ui/layout";
import { RootHeaderContext } from "../ui/rootHeader";
import { useTheme, type Theme } from "../ui/theme";

export interface ShellSection {
  readonly id: string;
  readonly title: string;
  readonly symbol: SymbolViewProps["name"];
  readonly selectedSymbol?: SymbolViewProps["name"];
  readonly route: StackRouteName;
  readonly badge?: string;
}

export interface ShellScreen {
  readonly name: StackRouteName;
  readonly component: ComponentType<object>;
  readonly options?:
    | NativeStackNavigationOptions
    | ((params: never) => NativeStackNavigationOptions);
}

const Stack = createNativeStackNavigator<StackRoutes>();

function navigationTheme(theme: Theme): NavigationTheme {
  const base = theme.dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.color.accent,
      background: theme.color.background,
      card: theme.color.background,
      text: theme.color.label,
      border: theme.color.separator,
    },
  };
}

function screenOptions(theme: Theme): NativeStackNavigationOptions {
  return {
    headerLargeTitle: false,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerStyle: { backgroundColor: theme.color.background },
    headerTitleStyle: { color: theme.color.label, fontFamily: theme.font.family },
    headerLargeTitleStyle: { color: theme.color.label, fontFamily: theme.font.family },
    headerTintColor: theme.color.accent,
    contentStyle: { backgroundColor: theme.color.background },
  };
}

function SectionStack(props: {
  readonly navRef?: NavigationContainerRefWithCurrent<StackRoutes>;
  readonly section: ShellSection;
  readonly screens: ReadonlyArray<ShellScreen>;
  readonly headerRight?: () => ReactNode;
  readonly initial?: {
    readonly name: StackRouteName;
    readonly params?: object;
    readonly title?: string;
  };
}) {
  const theme = useTheme();
  const navTheme = useMemo(() => navigationTheme(theme), [theme]);
  const rootName = props.initial?.name ?? props.section.route;
  return (
    <RootHeaderContext
      value={{ route: props.section.route, title: props.section.title, right: props.headerRight }}
    >
      <NavigationIndependentTree>
        <NavigationContainer theme={navTheme} {...(props.navRef ? { ref: props.navRef } : {})}>
          <Stack.Navigator initialRouteName={rootName} screenOptions={screenOptions(theme)}>
            {props.screens.map((screen) => {
              const isRoot = screen.name === rootName;
              return (
                <Stack.Screen
                  key={screen.name}
                  name={screen.name}
                  component={screen.component}
                  {...(isRoot && props.initial?.params
                    ? { initialParams: props.initial.params as never }
                    : {})}
                  options={(route) => {
                    const own =
                      typeof screen.options === "function"
                        ? (screen.options as (params: unknown) => NativeStackNavigationOptions)(
                            route.route.params,
                          )
                        : (screen.options ?? {});
                    return isRoot
                      ? {
                          ...own,
                          ...(props.initial?.title ? { title: props.initial.title } : {}),
                          ...(screen.name === props.section.route
                            ? { title: props.section.title, headerShown: false }
                            : props.headerRight
                              ? { headerRight: props.headerRight }
                              : {}),
                        }
                      : own;
                  }}
                />
              );
            })}
          </Stack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </RootHeaderContext>
  );
}

/** Something the iPad sidebar lists under the sections: a conversation, with a label. */
export interface SidebarItem {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly symbol: SymbolViewProps["name"];
  readonly open: { readonly name: StackRouteName; readonly params: object; readonly title: string };
}

export function Shell(props: {
  readonly sections: ReadonlyArray<ShellSection>;
  readonly screens: ReadonlyArray<ShellScreen>;
  readonly sidebarTitle: string;
  readonly sidebarSubtitle?: string;
  readonly sidebarItemsTitle?: string;
  readonly sidebarItems?: ReadonlyArray<SidebarItem>;
  readonly headerRight?: () => ReactNode;
  readonly sidebarFooter?: ReactNode;
}) {
  const layout = useLayout();
  const theme = useTheme();
  const [selected, setSelected] = useState(props.sections[0]!.id);
  const [opened, setOpened] = useState<SidebarItem | null>(null);
  const [provenance, setProvenance] = useState(0);
  const refs = useMemo(
    () =>
      new Map(
        props.sections.map((section) => [section.id, createNavigationContainerRef<StackRoutes>()]),
      ),
    // One stack per section for the life of the shell.
    [],
  );
  const sectionLink = useDeepLink("section");
  const conversationLink = useDeepLink("conversation");
  useEffect(() => {
    const link = sectionLink.link;
    if (link === null) return;
    sectionLink.consume();
    if (!props.sections.some((section) => section.id === link.id)) return;
    setOpened(null);
    setSelected(link.id);
  }, [sectionLink, props.sections]);
  useEffect(() => {
    const link = conversationLink.link;
    if (link === null) return;
    conversationLink.consume();
    const params = { macId: link.macId, threadId: link.threadId, title: "Conversation" };
    if (layout.usesSplitView) {
      setOpened({
        key: `${link.macId}:${link.threadId}`,
        title: "Conversation",
        subtitle: "",
        symbol: "bubble.left",
        open: { name: "Conversation", params, title: "Conversation" },
      });
      return;
    }
    const first = props.sections[0]!.id;
    setSelected(first);
    const ref = refs.get(first);
    setTimeout(() => {
      if (ref?.isReady()) ref.navigate("Conversation", params);
    }, 300);
  }, [conversationLink, layout.usesSplitView, props.sections, refs]);

  if (!layout.usesSplitView) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.background }}>
        <Tabs.Host
          navStateRequest={{ selectedScreenKey: selected, baseProvenance: provenance }}
          ios={{
            tabBarControllerMode: "tabBar",
            tabBarMinimizeBehavior: "never",
            tabBarTintColor: theme.color.accent,
          }}
          onTabSelected={({ nativeEvent }: NativeSyntheticEvent<TabSelectedEvent>) => {
            setProvenance(nativeEvent.provenance);
            if (nativeEvent.actionOrigin === "programmatic-js") return;
            haptic();
            setSelected(nativeEvent.selectedScreenKey);
          }}
          onTabSelectionRejected={({
            nativeEvent,
          }: NativeSyntheticEvent<TabSelectionRejectedEvent>) =>
            setProvenance(nativeEvent.provenance)
          }
        >
          {props.sections.map((section) => (
            <Tabs.Screen
              key={section.id}
              screenKey={section.id}
              title={section.title}
              {...(section.badge ? { badgeValue: section.badge } : {})}
              tabBarItemAccessibilityLabel={section.title}
              ios={{
                icon: { type: "sfSymbol", name: section.symbol },
                ...(section.selectedSymbol
                  ? { selectedIcon: { type: "sfSymbol", name: section.selectedSymbol } }
                  : {}),
              }}
            >
              <SectionStack
                navRef={refs.get(section.id)!}
                section={section}
                screens={props.screens}
                {...(props.headerRight ? { headerRight: props.headerRight } : {})}
              />
            </Tabs.Screen>
          ))}
        </Tabs.Host>
      </View>
    );
  }

  const section =
    props.sections.find((candidate) => candidate.id === selected) ?? props.sections[0]!;
  const contentKey = opened ? `item:${opened.key}` : `section:${section.id}`;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.color.background }}>
      <SafeAreaView
        edges={["top", "bottom", "left"]}
        style={{
          width: layout.sidebarWidth,
          backgroundColor:
            theme.look === "workshop" ? theme.color.cardRaised : theme.dark ? "#1C1C1E" : "#F2F2F7",
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: theme.color.separator,
        }}
      >
        <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8 }}>
            <Txt variant="title1">{props.sidebarTitle}</Txt>
            {props.sidebarSubtitle ? (
              <Txt variant="subheadline" tone="label2">
                {props.sidebarSubtitle}
              </Txt>
            ) : null}
          </View>
          {props.sections.map((candidate) => (
            <SidebarRow
              key={candidate.id}
              title={candidate.title}
              symbol={candidate.symbol}
              selected={opened === null && candidate.id === section.id}
              badge={candidate.badge}
              onPress={() => {
                setOpened(null);
                setSelected(candidate.id);
              }}
            />
          ))}
          {props.sidebarItems && props.sidebarItems.length > 0 ? (
            <View style={{ marginTop: 18 }}>
              <Txt
                variant="footnote"
                tone="label2"
                style={{ marginHorizontal: 20, marginBottom: 6, textTransform: "uppercase" }}
              >
                {props.sidebarItemsTitle ?? "Conversations"}
              </Txt>
              {props.sidebarItems.map((item) => (
                <SidebarRow
                  key={item.key}
                  title={item.title}
                  subtitle={item.subtitle}
                  symbol={item.symbol}
                  selected={opened?.key === item.key}
                  onPress={() => setOpened(item)}
                />
              ))}
            </View>
          ) : null}
          {props.sidebarFooter}
        </ScrollView>
      </SafeAreaView>
      <View style={{ flex: 1 }}>
        <SectionStack
          key={contentKey}
          section={section}
          screens={props.screens}
          {...(props.headerRight ? { headerRight: props.headerRight } : {})}
          {...(opened ? { initial: opened.open } : {})}
        />
      </View>
    </View>
  );
}

function SidebarRow(props: {
  readonly title: string;
  readonly subtitle?: string;
  readonly symbol: SymbolViewProps["name"];
  readonly selected: boolean;
  readonly badge?: string | undefined;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={props.title}
      onPress={() => {
        haptic();
        props.onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginHorizontal: 10,
        paddingHorizontal: 12,
        paddingVertical: props.subtitle ? 8 : 11,
        borderRadius: 10,
        backgroundColor: props.selected
          ? theme.color.accent
          : pressed
            ? theme.color.fill
            : "transparent",
      })}
    >
      <Symbol
        name={props.symbol}
        size={20}
        color={props.selected ? theme.color.onAccent : theme.color.accent}
      />
      <View style={{ flex: 1 }}>
        <Txt numberOfLines={1} tone={props.selected ? "onAccent" : "label"}>
          {props.title}
        </Txt>
        {props.subtitle ? (
          <Txt variant="footnote" numberOfLines={1} tone={props.selected ? "onAccent" : "label2"}>
            {props.subtitle}
          </Txt>
        ) : null}
      </View>
      {props.badge ? (
        <View
          style={{
            minWidth: 22,
            paddingHorizontal: 6,
            height: 22,
            borderRadius: 11,
            backgroundColor: props.selected ? theme.color.onAccent : theme.color.red,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Txt
            variant="caption"
            weight="700"
            style={{ color: props.selected ? theme.color.accent : "#FFFFFF" }}
          >
            {props.badge}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

export function HeaderButton(props: {
  readonly symbol: SymbolViewProps["name"];
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={10}
    >
      <Symbol name={props.symbol} size={22} />
    </Pressable>
  );
}
