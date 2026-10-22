import { Bell, BellOff, BellRing, CircleAlert, Volume2 } from "lucide-react";
import { useState } from "react";

import { PRODUCT_NAME } from "../../../brand";
import { useCrew } from "../../../themes/useCrew";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { Sheet } from "../../../ui/Sheet";
import { StepBadge } from "../../../ui/StepBadge";
import { Switch } from "../../../ui/Switch";
import { useFamily } from "../../family/FamilyProvider";
import { unlockNotificationAudio } from "~/threadNotifications";
import {
  askPermission,
  deniedHelp,
  useNotifySettings,
  usePermission,
  writeNotifySwitch,
  type NotifySwitch,
} from "../../notifications/prefs";
import { SettingsGroup } from "../SettingsGroup";

/**
 * Settings › Notifications. The browser (or the Mac, in the desktop app) is asked only when
 * someone turns a switch on or presses Allow, after one plain sentence about what will show.
 * Nothing is asked on page load. A "no" is shown with the way to change it.
 */
export function NotificationsPane() {
  const settings = useNotifySettings();
  const family = useFamily();
  const builder = useCrew().builder.name;
  const [permission, setPermission] = usePermission();
  const [asking, setAsking] = useState<NotifySwitch | "allow" | null>(null);
  const desktop = window.desktopBridge !== undefined;
  const anyOn = settings.finished || settings.needsOk || settings.failed;

  const flip = (key: NotifySwitch, on: boolean) => {
    if (key === "sound" && on) unlockNotificationAudio();
    if (on && key !== "sound" && permission === "default") {
      setAsking(key);
      return;
    }
    writeNotifySwitch(key, on, family.enabled);
  };

  const confirmAsk = async () => {
    const pending = asking;
    setAsking(null);
    const answer = await askPermission();
    setPermission(answer);
    if (answer === "granted" && pending !== null && pending !== "allow") {
      writeNotifySwitch(pending, true, family.enabled);
    }
  };

  const status =
    permission === "unsupported"
      ? {
          state: "warn" as const,
          icon: BellOff,
          title: "This window can't show notifications",
          subtitle: `Use the ${PRODUCT_NAME} app on your Mac, or a browser like Safari, Chrome or Edge.`,
        }
      : permission === "denied"
        ? {
            state: "fail" as const,
            icon: CircleAlert,
            title: "Notifications are blocked",
            subtitle: deniedHelp(desktop),
          }
        : permission === "default"
          ? {
              state: "todo" as const,
              icon: Bell,
              title: anyOn ? "One more step: allow notifications" : "Not allowed yet",
              subtitle: family.enabled
                ? `Allow them so a grown-up hears when ${builder} needs one.`
                : `${PRODUCT_NAME} asks your ${desktop ? "Mac" : "browser"} when you turn one on.`,
            }
          : {
              state: "ok" as const,
              icon: BellRing,
              title: anyOn ? "On for this device" : "Allowed on this device",
              subtitle: desktop
                ? "Nothing showing? Check System Settings › Notifications › SKYCOT."
                : "They show while SKYCOT is open in a tab, even in the background.",
            };

  const row = (key: Exclude<NotifySwitch, "sound">, title: string, subtitle: string) => (
    <ListRow
      key={key}
      title={title}
      subtitle={subtitle}
      trailing={
        <Switch
          checked={settings[key]}
          disabled={permission === "unsupported" || asking !== null}
          onChange={(on) => flip(key, on)}
          label={title}
        />
      }
    />
  );

  return (
    <>
      <SettingsGroup
        title="On this device"
        footer={
          family.enabled
            ? `On by default in a Family profile, so a grown-up hears when ${builder} needs one. Anyone can change these here; no code needed.`
            : undefined
        }
      >
        <ListRow
          leading={<StepBadge state={status.state} icon={status.icon} />}
          title={status.title}
          subtitle={status.subtitle}
          trailing={
            permission === "default" ? (
              <Button
                size="sm"
                variant={anyOn ? "primary" : "secondary"}
                onClick={() => setAsking("allow")}
              >
                Allow…
              </Button>
            ) : null
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Tell me when"
        footer={`A notification says who and which project, like “${builder} needs your OK in Space game”. Never your messages, files or anyone's details. Click it to open that conversation.`}
      >
        {row("finished", `${builder}'s finished`, "When a job is done and ready to look at.")}
        {row(
          "needsOk",
          `${builder} needs your OK`,
          family.enabled
            ? "A step to allow, a plan to build, a question, or a step that needs a grown-up."
            : "A step to allow, a plan to build, or a question.",
        )}
        {row("failed", "Something goes wrong", `When ${builder} has to stop part-way.`)}
      </SettingsGroup>

      <SettingsGroup
        title="Sound"
        footer="A soft chime with each notification. Off unless you turn it on."
      >
        <ListRow
          leading={<StepBadge state={settings.sound ? "ok" : "todo"} icon={Volume2} />}
          title="Play a sound"
          trailing={
            <Switch
              checked={settings.sound}
              disabled={permission === "unsupported"}
              onChange={(on) => flip("sound", on)}
              label="Play a sound"
            />
          }
        />
      </SettingsGroup>

      <Sheet
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={`Let ${PRODUCT_NAME} tell you`}
        icon={BellRing}
        description={
          <>
            {PRODUCT_NAME} can show a short note when {builder} finishes, needs your OK, or
            something goes wrong, even when this window is in the background. Your{" "}
            {desktop ? "Mac" : "browser"} will now ask once: choose <b>Allow</b>.
          </>
        }
        actions={
          <>
            <Button onClick={() => setAsking(null)}>Not now</Button>
            <Button variant="primary" onClick={() => void confirmAsk()}>
              Continue
            </Button>
          </>
        }
      />
    </>
  );
}
