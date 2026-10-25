/**
 * "Open it": a page a child made, shown inside SKYCOT with no internet. The Mac sends a copy of
 * the page with its own pictures and styles inside it and no code at all (the engine's
 * family-fridge/thumbnail.ts), with offline rules of its own. Here code stays off as well, and
 * anything that tries to leave for a website is stopped: on a phone or iPad a page never
 * reaches the internet, the way a grown-up's yes allows it only on the Mac.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { familyApi } from "../../family/api";
import type { Mac } from "../../links/store";
import { Banner, Spinner } from "../../ui/kit";
import { useTheme } from "../../ui/theme";

export function PagePreview(props: {
  readonly mac: Mac;
  readonly threadId: string;
  readonly page: string;
}) {
  const theme = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void familyApi.fridgePage(props.mac.transport, props.threadId, props.page).then((result) => {
      if (!live) return;
      if (result.ok) setHtml(result.value);
      else setProblem(result.message);
    });
    return () => {
      live = false;
    };
  }, [props.mac, props.threadId, props.page]);

  if (problem !== null) {
    return (
      <View style={{ flex: 1, padding: 20, backgroundColor: theme.color.background }}>
        <Banner tone="warning" text={problem} />
      </View>
    );
  }
  if (html === null) return <Spinner />;
  return (
    <WebView
      source={{ html, baseUrl: "about:blank" }}
      javaScriptEnabled={false}
      originWhitelist={["about:*"]}
      onShouldStartLoadWithRequest={(request) => !/^https?:/iu.test(request.url)}
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      allowFileAccess={false}
      incognito
      style={{ flex: 1, backgroundColor: "#FFFFFF" }}
    />
  );
}
