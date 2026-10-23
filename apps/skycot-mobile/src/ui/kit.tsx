/**
 * The building blocks every screen uses, in standard iOS shapes: inset grouped lists with
 * chevrons, filled and tinted buttons, a segmented control, sheets, SF Symbols. Workshop only
 * changes colours, corners and the ink outline; the shapes stay Apple's.
 */
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { Children, Fragment, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { avatarLetter } from "../../../nondev/src/features/family/children";
import type { ChildAvatar } from "../../../nondev/src/features/family/children";
import { AVATAR_COLORS, mascotSource, skyPhaseNow, type MascotPose } from "./brand";
import { TEXT, useTheme, type Theme } from "./theme";

type TextVariant = keyof typeof TEXT;
type Tone = "label" | "label2" | "label3" | "accent" | "red" | "green" | "orange" | "onAccent";

export function Txt(
  props: TextProps & {
    readonly variant?: TextVariant;
    readonly tone?: Tone;
    readonly weight?: TextStyle["fontWeight"];
    readonly center?: boolean;
  },
) {
  const theme = useTheme();
  const { variant = "body", tone = "label", weight, center, style, ...rest } = props;
  return (
    <Text
      {...rest}
      style={[
        TEXT[variant],
        { color: theme.color[tone], fontFamily: theme.font.family },
        weight === undefined ? null : { fontWeight: weight },
        center ? { textAlign: "center" } : null,
        style,
      ]}
    />
  );
}

export function Symbol(props: {
  readonly name: SymbolViewProps["name"];
  readonly size?: number;
  readonly color?: string;
  readonly weight?: SymbolViewProps["weight"];
  readonly style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const size = props.size ?? 20;
  return (
    <SymbolView
      name={props.name}
      size={size}
      tintColor={props.color ?? theme.color.accent}
      weight={props.weight ?? "regular"}
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, props.style]}
    />
  );
}

export function haptic(kind: "tap" | "success" | "warning" = "tap") {
  if (kind === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (kind === "warning")
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  else void Haptics.selectionAsync();
}

/** A scrolling page on the grouped background, under a large title. */
export function Page(
  props: ScrollViewProps & { readonly children: ReactNode; readonly maxWidth?: number },
) {
  const theme = useTheme();
  const { children, maxWidth = 720, style, contentContainerStyle, ...rest } = props;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      {...rest}
      style={[{ flex: 1, backgroundColor: theme.color.background }, style]}
      contentContainerStyle={[{ paddingBottom: 40 }, contentContainerStyle]}
    >
      <View style={{ width: "100%", maxWidth, alignSelf: "center" }}>{children}</View>
    </ScrollView>
  );
}

function cardFrame(theme: Theme): ViewStyle {
  return {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.card,
    ...(theme.look === "workshop"
      ? {
          borderWidth: 1.5,
          borderColor: theme.color.outline,
          shadowColor: theme.color.outline,
          shadowOffset: { width: theme.cardShadow!.x, height: theme.cardShadow!.y },
          shadowOpacity: theme.dark ? 0.35 : 1,
          shadowRadius: 0,
        }
      : {}),
  };
}

export function Card(props: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly padded?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[cardFrame(theme), props.padded === false ? null : { padding: 16 }, props.style]}>
      {props.children}
    </View>
  );
}

/** An inset grouped list section, like Settings. */
export function Section(props: {
  readonly title?: string;
  readonly footer?: string;
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const rows = Children.toArray(props.children).filter(Boolean);
  return (
    <View style={[{ marginHorizontal: 16, marginTop: 22 }, props.style]}>
      {props.title ? (
        <Txt
          variant="footnote"
          tone="label2"
          style={{ textTransform: "uppercase", marginLeft: 16, marginBottom: 7 }}
        >
          {props.title}
        </Txt>
      ) : null}
      {rows.length === 0 ? null : (
        <View
          style={[cardFrame(theme), { overflow: theme.look === "workshop" ? "visible" : "hidden" }]}
        >
          <View style={{ borderRadius: theme.radius.card, overflow: "hidden" }}>
            {rows.map((row, index) => (
              <Fragment key={index}>
                {index > 0 ? (
                  <View
                    style={{
                      height: StyleSheet.hairlineWidth,
                      backgroundColor: theme.color.separator,
                      marginLeft: 16,
                    }}
                  />
                ) : null}
                {row}
              </Fragment>
            ))}
          </View>
        </View>
      )}
      {props.footer ? (
        <Txt variant="footnote" tone="label2" style={{ marginHorizontal: 16, marginTop: 7 }}>
          {props.footer}
        </Txt>
      ) : null}
    </View>
  );
}

/** A Settings-style icon: a white SF Symbol on a small rounded square. */
export function RowIcon(props: { readonly name: SymbolViewProps["name"]; readonly color: string }) {
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 7,
        backgroundColor: props.color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Symbol name={props.name} size={18} color="#FFFFFF" weight="medium" />
    </View>
  );
}

export function Row(props: {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly detail?: string | null;
  readonly chevron?: boolean;
  readonly destructive?: boolean;
  readonly onPress?: () => void;
  readonly selected?: boolean;
  readonly accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const content = (pressed: boolean) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 12,
        backgroundColor: props.selected
          ? theme.color.accentSoft
          : pressed
            ? theme.color.fill
            : "transparent",
      }}
    >
      {props.leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt tone={props.destructive ? "red" : "label"} numberOfLines={2}>
          {props.title}
        </Txt>
        {props.subtitle ? (
          <Txt variant="subheadline" tone="label2" numberOfLines={3}>
            {props.subtitle}
          </Txt>
        ) : null}
      </View>
      {props.detail ? (
        <Txt tone="label2" numberOfLines={1}>
          {props.detail}
        </Txt>
      ) : null}
      {props.trailing}
      {props.chevron ? (
        <Symbol name="chevron.right" size={13} color={theme.color.label3} weight="semibold" />
      ) : null}
    </View>
  );
  if (props.onPress === undefined) return content(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      onPress={props.onPress}
    >
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

export type ButtonKind = "filled" | "tinted" | "plain" | "destructive" | "grey";

export function Button(props: {
  readonly title: string;
  readonly onPress: () => void;
  readonly kind?: ButtonKind;
  readonly icon?: SymbolViewProps["name"];
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly size?: "large" | "medium" | "small";
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const kind = props.kind ?? "filled";
  const size = props.size ?? "large";
  const background =
    kind === "filled"
      ? theme.color.accent
      : kind === "tinted"
        ? theme.color.accentSoft
        : kind === "destructive"
          ? theme.dark
            ? "#3A1A17"
            : "#FDE7E5"
          : kind === "grey"
            ? theme.color.fill
            : "transparent";
  const foreground =
    kind === "filled"
      ? theme.color.onAccent
      : kind === "destructive"
        ? theme.color.red
        : kind === "grey"
          ? theme.color.label
          : theme.color.accent;
  const workshopEdge =
    theme.look === "workshop" && (kind === "filled" || kind === "grey" || kind === "tinted")
      ? {
          borderWidth: 1.5,
          borderColor: theme.color.outline,
          shadowColor: theme.color.outline,
          shadowOffset: { width: 2, height: 2 },
          shadowOpacity: theme.dark ? 0.35 : 1,
          shadowRadius: 0,
        }
      : {};
  const inactive = props.disabled === true || props.busy === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      accessibilityState={{ disabled: inactive, busy: props.busy === true }}
      disabled={inactive}
      onPress={() => {
        haptic();
        props.onPress();
      }}
      style={({ pressed }) => [
        {
          minHeight: size === "large" ? 50 : size === "medium" ? 40 : 32,
          paddingHorizontal: size === "small" ? 12 : 18,
          borderRadius: size === "small" ? 999 : theme.radius.control + 2,
          backgroundColor: background,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        workshopEdge,
        props.style,
      ]}
    >
      {props.busy ? <ActivityIndicator color={foreground} /> : null}
      {!props.busy && props.icon ? (
        <Symbol
          name={props.icon}
          size={size === "small" ? 15 : 18}
          color={foreground}
          weight="semibold"
        />
      ) : null}
      <Text
        style={[
          size === "small" ? TEXT.subheadline : TEXT.headline,
          { color: foreground, fontFamily: theme.font.family, fontWeight: "600" },
        ]}
        numberOfLines={1}
      >
        {props.title}
      </Text>
    </Pressable>
  );
}

export function Banner(props: {
  readonly text: string;
  readonly tone?: "info" | "warning" | "success";
  readonly action?: { readonly title: string; readonly onPress: () => void };
}) {
  const theme = useTheme();
  const tone = props.tone ?? "info";
  const color =
    tone === "warning"
      ? theme.color.orange
      : tone === "success"
        ? theme.color.green
        : theme.color.accent;
  const icon: SymbolViewProps["name"] =
    tone === "warning"
      ? "exclamationmark.triangle.fill"
      : tone === "success"
        ? "checkmark.circle.fill"
        : "info.circle.fill";
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: theme.radius.control,
        backgroundColor: theme.color.fill,
        alignItems: "flex-start",
      }}
    >
      <Symbol name={icon} size={18} color={color} />
      <View style={{ flex: 1, gap: 8 }}>
        <Txt variant="subheadline">{props.text}</Txt>
        {props.action ? (
          <Button
            title={props.action.title}
            onPress={props.action.onPress}
            kind="tinted"
            size="small"
            style={{ alignSelf: "flex-start" }}
          />
        ) : null}
      </View>
    </View>
  );
}

export function Mascot(props: { readonly pose: MascotPose; readonly size?: number }) {
  const size = props.size ?? 96;
  return (
    <Image
      source={mascotSource(props.pose, skyPhaseNow())}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

export function EmptyState(props: {
  readonly title: string;
  readonly body?: string;
  readonly pose?: MascotPose;
  readonly symbol?: SymbolViewProps["name"];
  readonly children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 32, paddingVertical: 40, gap: 10 }}>
      {props.pose ? <Mascot pose={props.pose} size={110} /> : null}
      {props.symbol ? <Symbol name={props.symbol} size={44} color={theme.color.label3} /> : null}
      <Txt variant="title3" center>
        {props.title}
      </Txt>
      {props.body ? (
        <Txt tone="label2" center>
          {props.body}
        </Txt>
      ) : null}
      {props.children}
    </View>
  );
}

export function Avatar(props: {
  readonly person: { readonly avatar: ChildAvatar; readonly name: string | null };
  readonly size?: number;
}) {
  const theme = useTheme();
  const size = props.size ?? 40;
  if (props.person.avatar.kind === "mascot") {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.color.fill,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Mascot pose={props.person.avatar.pose} size={size} />
      </View>
    );
  }
  const swatch = AVATAR_COLORS[props.person.avatar.color] ?? AVATAR_COLORS.sky!;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.dark ? swatch.dark : swatch.light,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: Math.round(size * 0.44) }}>
        {avatarLetter(props.person)}
      </Text>
    </View>
  );
}

export function Pill(props: {
  readonly text: string;
  readonly tone?: "accent" | "orange" | "green" | "grey";
}) {
  const theme = useTheme();
  const tone = props.tone ?? "grey";
  const color =
    tone === "accent"
      ? theme.color.accent
      : tone === "orange"
        ? theme.color.orange
        : tone === "green"
          ? theme.color.green
          : theme.color.label2;
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: theme.color.fill,
      }}
    >
      <Txt variant="caption" weight="600" style={{ color }}>
        {props.text}
      </Txt>
    </View>
  );
}

/** A segmented control in the iOS style. */
export function Segmented<T extends string>(props: {
  readonly options: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={props.accessibilityLabel}
      style={{
        flexDirection: "row",
        backgroundColor: theme.color.fill,
        borderRadius: 9,
        padding: 2,
      }}
    >
      {props.options.map((option) => {
        const selected = option.id === props.value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) haptic();
              props.onChange(option.id);
            }}
            style={{
              flex: 1,
              paddingVertical: 7,
              borderRadius: 7,
              alignItems: "center",
              backgroundColor: selected ? (theme.dark ? "#636366" : "#FFFFFF") : "transparent",
              shadowColor: "#000",
              shadowOpacity: selected && !theme.dark ? 0.12 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            <Txt variant="footnote" weight={selected ? "600" : "500"} numberOfLines={1}>
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A sheet from the bottom with Cancel on the left, like Mail's and Calendar's. */
export function Sheet(props: {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly closeLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <View style={{ flex: 1, backgroundColor: theme.color.background }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 10,
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={props.onClose}
            style={{ position: "absolute", left: 16, top: 16 }}
            hitSlop={10}
          >
            <Txt tone="accent">{props.closeLabel ?? "Cancel"}</Txt>
          </Pressable>
          <Txt variant="headline" numberOfLines={1} style={{ maxWidth: "60%" }}>
            {props.title}
          </Txt>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}
        >
          {props.children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The parent code: digits only, hidden, 4 to 6 long, as the Mac asks for it. */
export function ParentCodeField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: () => void;
  readonly problem?: string | null;
  readonly autoFocus?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="footnote" tone="label2" style={{ textTransform: "uppercase", marginLeft: 4 }}>
        Parent code
      </Txt>
      <TextInput
        value={props.value}
        onChangeText={(text) => props.onChange(text.replace(/\D/gu, "").slice(0, 6))}
        onSubmitEditing={props.onSubmit}
        placeholder="••••"
        placeholderTextColor={theme.color.label3}
        keyboardType="number-pad"
        secureTextEntry
        textContentType="oneTimeCode"
        autoFocus={props.autoFocus ?? true}
        maxLength={6}
        accessibilityLabel="Parent code"
        style={{
          backgroundColor: theme.color.card,
          borderRadius: theme.radius.control,
          paddingHorizontal: 16,
          paddingVertical: 14,
          fontSize: 28,
          letterSpacing: 10,
          textAlign: "center",
          color: theme.color.label,
          borderWidth: theme.look === "workshop" ? 1.5 : 0,
          borderColor: theme.color.outline,
        }}
      />
      <Txt variant="footnote" tone={props.problem ? "red" : "label2"} style={{ marginLeft: 4 }}>
        {props.problem ?? "4 to 6 digits. Five wrong tries mean a five-minute wait."}
      </Txt>
    </View>
  );
}

/** A sheet that asks for the parent code, then does one thing. */
export function ParentCodeSheet(props: {
  readonly visible: boolean;
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onClose: () => void;
  /** Resolves to a problem sentence to show, or null when it worked. */
  readonly onCode: (code: string) => Promise<string | null>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setCode("");
    setProblem(null);
    props.onClose();
  };
  const submit = async () => {
    if (code.length < 4 || busy) return;
    setBusy(true);
    const result = await props.onCode(code);
    setBusy(false);
    if (result === null) {
      haptic("success");
      setCode("");
      setProblem(null);
      return;
    }
    haptic("warning");
    setCode("");
    setProblem(result);
  };
  return (
    <Sheet visible={props.visible} title={props.title} onClose={close}>
      <View style={{ alignItems: "center", gap: 8, paddingTop: 8 }}>
        <Symbol name="lock.fill" size={34} />
        <Txt center tone="label2">
          {props.description}
        </Txt>
      </View>
      <ParentCodeField value={code} onChange={setCode} onSubmit={submit} problem={problem} />
      <Button
        title={busy ? "Checking…" : props.actionLabel}
        onPress={submit}
        busy={busy}
        disabled={code.length < 4}
      />
    </Sheet>
  );
}

export function Spinner() {
  const theme = useTheme();
  return (
    <View style={{ padding: 40, alignItems: "center" }}>
      <ActivityIndicator color={theme.color.label2} />
    </View>
  );
}

/** A plain full-height background for screens that aren't lists. */
export function Fill(props: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[{ flex: 1, backgroundColor: theme.color.background }, props.style]}
    >
      {props.children}
    </SafeAreaView>
  );
}
