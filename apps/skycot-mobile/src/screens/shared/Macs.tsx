/**
 * This device's Macs: each one it is linked to, by name, how it is reached, and who this
 * device is there; "Link another Mac" for a family with two working Macs (their conversations
 * then show side by side, each labelled with its Mac); and About.
 */
import { useState } from "react";

import { familyApi } from "../../family/api";
import { useMacData } from "../../data/MacData";
import { useLinks, type Mac } from "../../links/store";
import { AboutSheet } from "./About";
import { Page, ParentCodeSheet, Row, RowIcon, Section } from "../../ui/kit";
import { useTheme } from "../../ui/theme";
import { ScanSheet, TypeCodeSheet } from "../link/LinkSheets";

function whoHere(
  mac: Mac,
  names: { readonly child: string | null; readonly grownUp: string | null },
): string {
  if (mac.me.kind === "child") return `${mac.me.deviceName} · ${names.child ?? "a child"}'s device`;
  return `${mac.me.deviceName} · ${names.grownUp ?? "a grown-up"}'s device`;
}

export function MacsScreen() {
  const theme = useTheme();
  const links = useLinks();
  const { byMac } = useMacData();
  const [sheet, setSheet] = useState<"scan" | "type" | "about" | null>(null);
  const [forgetting, setForgetting] = useState<Mac | null>(null);
  return (
    <Page>
      <Section
        title="Linked Macs"
        footer={
          links.macs.length > 1
            ? "Each conversation stays on the Mac where it started. SKYCOT shows them side by side, labelled with their Mac."
            : "This device reaches the Mac on your home Wi-Fi or Tailscale. Reaching it from anywhere comes with SKYCOT Relay."
        }
      >
        {links.macs.map((mac) => {
          const status = byMac[mac.macId]?.status ?? null;
          const child =
            mac.me.kind === "child"
              ? (status?.children.find((c) => c.id === (mac.me as { childId: string }).childId)
                  ?.name ?? null)
              : null;
          const grownUp =
            mac.me.kind === "grown-up"
              ? (status?.grownUps?.find((g) => g.id === (mac.me as { personId: string }).personId)
                  ?.name ?? null)
              : null;
          const reachable = byMac[mac.macId]?.reachable !== false;
          return (
            <Row
              key={mac.macId}
              leading={
                <RowIcon
                  name="desktopcomputer"
                  color={reachable ? theme.color.accent : theme.color.label3}
                />
              }
              title={mac.macName}
              subtitle={`${whoHere(mac, { child, grownUp })}\n${reachable ? mac.transport.routeLabel : "Not answering right now"}`}
              onPress={links.mode === "child" ? () => setForgetting(mac) : undefined}
            />
          );
        })}
        <Row
          leading={<RowIcon name="plus" color={theme.color.green} />}
          title="Link another Mac"
          subtitle="Scan the code in that Mac's Settings › Family."
          chevron
          onPress={() => setSheet("scan")}
        />
      </Section>
      <Section>
        <Row
          leading={<RowIcon name="info" color="#8E8E93" />}
          title="About SKYCOT"
          chevron
          onPress={() => setSheet("about")}
        />
      </Section>
      <ScanSheet
        visible={sheet === "scan"}
        onClose={() => setSheet(null)}
        onLinked={() => setSheet(null)}
        onType={() => setSheet("type")}
      />
      <TypeCodeSheet
        visible={sheet === "type"}
        onClose={() => setSheet(null)}
        onLinked={() => setSheet(null)}
      />
      <AboutSheet visible={sheet === "about"} onClose={() => setSheet(null)} />
      <ParentCodeSheet
        visible={forgetting !== null}
        title="Forget this Mac?"
        description={`This device stops showing ${forgetting?.macName ?? "this Mac"}. A grown-up enters the parent code; to remove it completely, remove it on the Mac too.`}
        actionLabel="Forget it"
        onClose={() => setForgetting(null)}
        onCode={async (code) => {
          if (forgetting === null) return null;
          const yes = await familyApi.verify(forgetting.transport, { code, purpose: "settings" });
          if (!yes.ok) return yes.message;
          await links.forget(forgetting.macId);
          setForgetting(null);
          return null;
        }}
      />
    </Page>
  );
}
