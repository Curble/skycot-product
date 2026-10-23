/**
 * Links that open SKYCOT at a place: the widget and Live Activity (`skycot://`), a section
 * (`skycot://section/fridge`), a conversation (`skycot://conversation/<mac>/<thread>`), and a
 * link code (`skycot://link?code=7KQ3M9XD2HPA&address=192.168.1.20:3773`), which only fills in
 * the "Type the code" sheet: linking still needs a tap on Link, and the code still has to come
 * from the family's Mac, once, within five minutes.
 *
 * Development builds also accept `&go=1` on a link code, so the Simulator check can link a
 * device without a person tapping, and a `-skycotTestLink <url>` launch argument (never in the
 * App Store build).
 */
import * as Linking from "expo-linking";
import { Platform, Settings } from "react-native";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { parseDeepLink, type DeepLink } from "./deepLinkParse";

export type { DeepLink };

interface DeepLinkValue {
  readonly pending: DeepLink | null;
  readonly consume: () => void;
}

const DeepLinkContext = createContext<DeepLinkValue>({ pending: null, consume: () => undefined });

export function DeepLinkProvider(props: { readonly children: ReactNode }) {
  const url = Linking.useURL();
  const [pending, setPending] = useState<DeepLink | null>(() => {
    // Development builds only: `xcrun simctl launch <device> <app> -skycotTestLink <url>` hands
    // the app a link at start, for the Simulator check (no system "Open in…" prompt to tap).
    if (!__DEV__ || Platform.OS !== "ios") return null;
    const test: unknown = Settings.get("skycotTestLink");
    const parsed = typeof test === "string" ? parseDeepLink(test, true) : null;
    if (typeof test === "string" && test.length > 0)
      console.log("[skycot] test link:", parsed?.kind ?? "unreadable");
    return parsed;
  });
  useEffect(() => {
    if (url !== null) setPending(parseDeepLink(url, __DEV__));
  }, [url]);
  const consume = useCallback(() => setPending(null), []);
  const value = useMemo(() => ({ pending, consume }), [pending, consume]);
  return <DeepLinkContext value={value}>{props.children}</DeepLinkContext>;
}

/** The waiting link of one kind, and a way to say it was handled. */
export function useDeepLink<K extends DeepLink["kind"]>(
  kind: K,
): { readonly link: Extract<DeepLink, { kind: K }> | null; readonly consume: () => void } {
  const { pending, consume } = use(DeepLinkContext);
  return {
    link: pending?.kind === kind ? (pending as Extract<DeepLink, { kind: K }>) : null,
    consume,
  };
}
