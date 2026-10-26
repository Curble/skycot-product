/** A child's page, packed by the Mac and opened inside a locked, private WebView. */
import { useCallback, useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import { Platform, Pressable, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { familyApi, type FridgePlay } from "../../family/api";
import type { Mac } from "../../links/store";
import { Banner, Button, Card, Spinner, Symbol, Txt } from "../../ui/kit";
import {
  grownUpAnswerLabel,
  type GrownUpAnswer,
} from "../../../../nondev/src/plain/grownUpAnswers";
import { useTheme } from "../../ui/theme";
import {
  allowsPlayNavigation,
  GAME_KEY_SCRIPTS,
  gameButtonsForPage,
  playableCopy,
  diagnosticReport,
  diagnosticSheetCopy,
  EMPTY_PAGE_DIAGNOSTICS,
  pageLooksWrong,
  parsePageDiagnostic,
  playNoticeCopy,
  type PlayNoticeKind,
  pageAskWaitingCopy,
  pageHasOwnGameControls,
  pageToolbarCopy,
  rememberGameButtons,
  reportedSites,
  type PlayCopy,
} from "./pagePreviewLogic";

// nondev-seam: skycot-mobile-page-preview
// nondev-seam: skycot-iphone-q39-page-preview
export function PagePreview(props: {
  readonly mac: Mac;
  readonly threadId: string;
  readonly page: string;
  readonly childView: boolean;
  readonly fullScreen?: boolean;
  readonly onDone: () => void;
  readonly onToggleFullScreen?: () => void;
  readonly onTellSam?: (message: string) => void;
}) {
  const theme = useTheme();
  const device = Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone";
  const insets = useSafeAreaInsets();
  const webView = useRef<WebView<object>>(null);
  const [play, setPlay] = useState<PlayCopy | null>(null);
  const [engineResponse, setEngineResponse] = useState<FridgePlay | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<PlayNoticeKind | null>(null);
  const [noticeHosts, setNoticeHosts] = useState<ReadonlyArray<string>>([]);
  const [sites, setSites] = useState<ReadonlyArray<string>>([]);
  const [hiddenSites, setHiddenSites] = useState<ReadonlyArray<string>>([]);
  const [request, setRequest] = useState<{
    readonly id: string;
    readonly sitesKey: string;
    readonly expiresAt: number;
  } | null>(null);
  const [answerLabel, setAnswerLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState(EMPTY_PAGE_DIAGNOSTICS);
  const [diagnosticsElapsed, setDiagnosticsElapsed] = useState(0);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const pageKey = `${props.mac.macId}:${props.threadId}:${props.page}`;
  const [gameButtons, setGameButtons] = useState(() => gameButtonsForPage(pageKey));
  const toolbarCopy = pageToolbarCopy(props.childView, props.fullScreen === true);
  const currentSitesKey = [...sites].sort().join(",");

  const loadPage = useCallback(async () => {
    setProblem(null);
    setPlay(null);
    setEngineResponse(null);
    setHtml(null);
    setDiagnostics(EMPTY_PAGE_DIAGNOSTICS);
    setDiagnosticsElapsed(0);
    setDiagnosticsOpen(false);
    setReportCopied(false);
    setNotice(null);
    setNoticeHosts([]);
    setSites([]);
    setHiddenSites([]);
    const result = await familyApi.fridgePlay(props.mac.transport, props.threadId, props.page);
    const playable = playableCopy(result);
    if (result.ok) {
      setEngineResponse(result.value);
      if (result.value.reason === "too-big") setNotice("too-big");
      else if (result.value.reason === "unpackable-module") setNotice("unpackable-module");
      else if (result.value.reason === "remote-script") {
        setNotice("remote-script");
        setNoticeHosts(result.value.needs.scripts);
      }
    } else if ("routeUnavailable" in result && result.routeUnavailable) {
      setNotice("engine-update");
    }
    if (playable !== null) {
      setPlay(playable);
      return;
    }
    const fallback = await familyApi.fridgePage(props.mac.transport, props.threadId, props.page);
    if (fallback.ok) setHtml(fallback.value);
    else setProblem(fallback.message);
  }, [props.mac, props.threadId, props.page]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (play?.html !== null && play?.html !== undefined) {
      setGameButtons(gameButtonsForPage(pageKey, pageHasOwnGameControls(play.html)));
    }
  }, [pageKey, play]);

  useEffect(() => {
    if (request === null) return;
    let live = true;
    const check = async () => {
      const result = await familyApi.grownUpAnswers(props.mac.transport, props.threadId);
      if (!live || !result.ok) return;
      const answer = result.value.find((entry: GrownUpAnswer) => entry.requestId === request.id);
      if (!answer) return;
      setAnswerLabel(grownUpAnswerLabel(answer));
      setRequest(null);
      if (answer.decision === "accept") void loadPage();
      else setHiddenSites((current) => [...new Set([...current, ...sites])]);
    };
    void check();
    const timer = setInterval(() => void check(), 1_500);
    const expiry = setTimeout(
      () => {
        if (!live) return;
        setAnswerLabel("The ask expired. You can ask again.");
        setRequest(null);
      },
      Math.max(0, request.expiresAt - Date.now()),
    );
    return () => {
      live = false;
      clearInterval(timer);
      clearTimeout(expiry);
    };
  }, [request, props.mac, props.threadId, loadPage, sites]);

  const askGrownUp = async () => {
    if (allowedPage === null || shownSites.length === 0 || busy) return;
    setBusy(true);
    setAnswerLabel(null);
    const result = await familyApi.askPageInternet(props.mac.transport, {
      threadId: props.threadId,
      page: allowedPage,
      sites: shownSites,
    });
    setBusy(false);
    if (result.ok) {
      setRequest({
        id: result.value.id,
        sitesKey: [...shownSites].sort().join(","),
        expiresAt: result.value.expiresAt,
      });
    } else setProblem(result.message);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    let data: unknown = event.nativeEvent.data;
    try {
      data = JSON.parse(event.nativeEvent.data) as unknown;
    } catch {
      return;
    }
    setSites((current) => reportedSites(data, current));
    setDiagnostics((current) => parsePageDiagnostic(data, current));
  };

  const wrong = pageLooksWrong(diagnostics, diagnosticsElapsed);
  const diagnosticCopy = diagnosticSheetCopy(
    diagnostics,
    props.childView,
    engineResponse?.diag
      ? { ...engineResponse.diag, reason: engineResponse.reason, needs: engineResponse.needs }
      : undefined,
    device,
  );
  const build =
    Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.version ?? "unknown";
  const report = diagnosticReport(
    diagnostics,
    {
      reason: engineResponse?.reason ?? null,
      needs: engineResponse?.needs ?? { scripts: [], other: [] },
      packedBytes: engineResponse?.diag.packedBytes ?? 0,
      embeddedFiles: engineResponse?.diag.embeddedFiles ?? 0,
      modulesBundled: engineResponse?.diag.modulesBundled ?? false,
      missingFiles: engineResponse?.diag.missingFiles ?? [],
    },
    build,
    play !== null ? "playable" : "still copy",
  );

  const toggleGameButtons = () => {
    const next = !gameButtons;
    setGameButtons(next);
    rememberGameButtons(pageKey, next);
  };

  const shownSites = sites.filter((site) => !hiddenSites.includes(site));
  const allowedPage = play?.page ?? null;
  const noticeCopy =
    notice === null ? null : playNoticeCopy(notice, props.childView, noticeHosts, device);
  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF", paddingTop: insets.top }}>
      <View
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.color.separator,
          backgroundColor: theme.color.background,
        }}
      >
        <ToolbarButton
          label={toolbarCopy.done}
          symbol="chevron.left"
          onPress={props.onDone}
          leading
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {props.onToggleFullScreen ? (
            <ToolbarButton
              label={toolbarCopy.fullScreen}
              symbol={
                props.fullScreen
                  ? "arrow.down.right.and.arrow.up.left"
                  : "arrow.up.left.and.arrow.down.right"
              }
              onPress={props.onToggleFullScreen}
            />
          ) : null}
          {play !== null ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={toolbarCopy.extraButtons}
              accessibilityState={{ checked: gameButtons }}
              onPress={toggleGameButtons}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 9,
                paddingVertical: 8,
                borderRadius: 18,
                backgroundColor: theme.color.fill,
              }}
            >
              <Txt variant="footnote" weight="600">
                {toolbarCopy.extraButtons}
              </Txt>
              <Symbol name={gameButtons ? "checkmark.circle.fill" : "circle"} size={18} />
            </Pressable>
          ) : null}
          {wrong || (engineResponse?.reason !== null && engineResponse?.reason !== undefined) ? (
            <ToolbarButton
              label={props.childView ? "Not working?" : "Why isn't it working?"}
              onPress={() => setDiagnosticsOpen(true)}
            />
          ) : null}
        </View>
      </View>
      {problem !== null ? (
        <View style={{ flex: 1, padding: 20, backgroundColor: theme.color.background }}>
          <Banner tone="warning" text={problem} />
        </View>
      ) : play === null && html === null ? (
        <Spinner />
      ) : (
        <WebView<object>
          ref={webView}
          source={{ html: play?.html ?? html!, baseUrl: "about:blank" }}
          javaScriptEnabled={play !== null}
          originWhitelist={["about:*"]}
          onShouldStartLoadWithRequest={(request) => allowsPlayNavigation(request.url)}
          onMessage={play === null ? undefined : onMessage}
          onLoadEnd={() => {
            setDiagnosticsElapsed(0);
            setTimeout(() => setDiagnosticsElapsed(3000), 3000);
          }}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          incognito
          allowsLinkPreview={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction
          sharedCookiesEnabled={false}
          cacheEnabled={false}
          style={{ flex: 1, backgroundColor: "#FFFFFF" }}
        />
      )}
      {play !== null ? (
        <>
          {shownSites.length > 0 ? (
            <View style={{ position: "absolute", top: 58, left: 12, right: 12, zIndex: 3 }}>
              <Card style={{ padding: 16, gap: 8, backgroundColor: theme.color.card }}>
                <Txt variant="headline">This page wants to use the internet</Txt>
                <Txt tone="label2">
                  {request !== null && request.sitesKey === currentSitesKey
                    ? pageAskWaitingCopy()
                    : `It wants to get things from ${shownSites.join(", ")}. A grown-up says yes once for this page.`}
                </Txt>
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
                  <Button
                    title="Not now"
                    kind="plain"
                    onPress={() => setHiddenSites((current) => [...current, ...shownSites])}
                  />
                  <Button
                    title={
                      busy
                        ? "Asking…"
                        : request?.sitesKey !== currentSitesKey
                          ? "Get a grown-up"
                          : "Update the ask"
                    }
                    busy={busy}
                    onPress={() => void askGrownUp()}
                  />
                </View>
              </Card>
            </View>
          ) : null}
          {gameButtons ? (
            <View
              style={{
                position: "absolute",
                left: Math.max(16, insets.left + 12),
                bottom: Math.max(20, insets.bottom + 12),
                width: 174,
                height: 174,
                zIndex: 2,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ width: 54 }} />
                <GameKeyButton
                  label="Up"
                  symbol="arrow.up"
                  scripts={GAME_KEY_SCRIPTS.ArrowUp}
                  webView={webView}
                />
                <View style={{ width: 54 }} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <GameKeyButton
                  label="Left"
                  symbol="arrow.left"
                  scripts={GAME_KEY_SCRIPTS.ArrowLeft}
                  webView={webView}
                />
                <GameKeyButton
                  label="Down"
                  symbol="arrow.down"
                  scripts={GAME_KEY_SCRIPTS.ArrowDown}
                  webView={webView}
                />
                <GameKeyButton
                  label="Right"
                  symbol="arrow.right"
                  scripts={GAME_KEY_SCRIPTS.ArrowRight}
                  webView={webView}
                />
              </View>
            </View>
          ) : null}
          {gameButtons ? (
            <View
              style={{
                position: "absolute",
                right: Math.max(20, insets.right + 16),
                bottom: Math.max(34, insets.bottom + 26),
                zIndex: 2,
              }}
            >
              <GameKeyButton
                label="Jump"
                symbol="arrow.up.to.line"
                scripts={GAME_KEY_SCRIPTS[" "]}
                webView={webView}
                jump
              />
            </View>
          ) : null}
        </>
      ) : null}
      {diagnosticsOpen ? (
        <View
          style={{ position: "absolute", top: insets.top + 56, left: 12, right: 12, zIndex: 5 }}
        >
          <Card style={{ padding: 16, gap: 10, backgroundColor: theme.color.card }}>
            <Txt variant="headline">{diagnosticCopy.headline}</Txt>
            {diagnosticCopy.lines.map((line, index) => (
              <Txt key={`${index}:${line}`} tone="label2">{`• ${line}`}</Txt>
            ))}
            {diagnosticCopy.grownUpLines.map((line, index) => (
              <Txt key={`grown-up:${index}`} tone="label2">
                {line}
              </Txt>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
              <Button
                title={reportCopied ? "Copied" : "Copy details"}
                kind="plain"
                onPress={() => {
                  void Clipboard.setStringAsync(report).then(() => setReportCopied(true));
                }}
              />
              {props.onTellSam ? (
                <Button
                  title="Tell Sam"
                  kind="plain"
                  onPress={() => {
                    props.onTellSam?.(diagnosticCopy.tellSam);
                    setDiagnosticsOpen(false);
                  }}
                />
              ) : null}
              <Button title="Done" kind="plain" onPress={() => setDiagnosticsOpen(false)} />
            </View>
          </Card>
        </View>
      ) : null}
      {answerLabel !== null ? (
        <View
          style={{ position: "absolute", top: insets.top + 58, left: 12, right: 12, zIndex: 3 }}
        >
          <Banner tone={answerLabel.endsWith("said yes") ? "success" : "info"} text={answerLabel} />
        </View>
      ) : null}
      {noticeCopy !== null ? (
        <View
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 12,
            right: 12,
            zIndex: 4,
          }}
        >
          <Card style={{ padding: 16, gap: 8, backgroundColor: theme.color.card }}>
            <Txt variant="headline">{noticeCopy.title}</Txt>
            <Txt tone="label2">{noticeCopy.message}</Txt>
            {noticeCopy.grownUp !== null ? <Txt tone="label2">{noticeCopy.grownUp}</Txt> : null}
            {noticeCopy.tellSam !== null &&
            noticeCopy.tellSamLabel !== null &&
            props.onTellSam !== undefined ? (
              <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                <Button
                  title={noticeCopy.tellSamLabel}
                  kind="plain"
                  onPress={() => props.onTellSam?.(noticeCopy.tellSam!)}
                />
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}
    </View>
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly symbol?:
    | "chevron.left"
    | "arrow.up.left.and.arrow.down.right"
    | "arrow.down.right.and.arrow.up.left";
  readonly onPress: () => void;
  readonly leading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={8}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 8,
        paddingHorizontal: 6,
      }}
    >
      {props.leading && props.symbol ? <Symbol name={props.symbol} size={18} /> : null}
      <Txt variant="footnote" weight="600" tone="accent">
        {props.label}
      </Txt>
      {!props.leading && props.symbol ? <Symbol name={props.symbol} size={18} /> : null}
    </Pressable>
  );
}

function GameKeyButton(props: {
  readonly label: string;
  readonly symbol: "arrow.up" | "arrow.down" | "arrow.left" | "arrow.right" | "arrow.up.to.line";
  readonly scripts: { readonly pressIn: string; readonly pressOut: string };
  readonly webView: React.RefObject<WebView<object> | null>;
  readonly jump?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPressIn={() => props.webView.current?.injectJavaScript(props.scripts.pressIn)}
      onPressOut={() => props.webView.current?.injectJavaScript(props.scripts.pressOut)}
      style={({ pressed }) => ({
        width: props.jump ? 74 : 54,
        height: props.jump ? 74 : 54,
        borderRadius: props.jump ? 37 : 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? "rgba(80,80,90,0.76)" : "rgba(80,80,90,0.48)",
      })}
    >
      {props.jump ? (
        <Txt variant="caption" tone="onAccent" weight="600">
          Jump
        </Txt>
      ) : (
        <Symbol name={props.symbol} size={24} color="#FFFFFF" />
      )}
    </Pressable>
  );
}
