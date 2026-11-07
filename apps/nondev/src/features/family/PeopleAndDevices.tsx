// Settings › Family on the family's Mac: the grown-ups, and the phones and iPads linked to a
// person. Linking makes a one-time link (a QR code and a short code to type) that the engine
// turns into that device's own sign-in; Remove ends it at once. Every change needs the parent
// code (the Family settings' yes), and the engine checks it again.
import { Check, Copy, Laptop, Plus, Smartphone, Tablet, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { QrCode } from "@t3tools/shared/qrCode";
import { qrImageSize } from "./qrSizing";
import {
  deviceKindLabel,
  deviceKindSummary,
  groupLinkCode,
  MAX_GROWN_UPS,
} from "@t3tools/skycot-rules/people";

import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { List, ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { Sheet } from "../../ui/Sheet";
import { StepBadge } from "../../ui/StepBadge";
import { TextField } from "../../ui/TextField";
import { SettingsGroup } from "../settings/SettingsGroup";
import { familyApi } from "./api";
import { AVATAR_CHARACTERS, CHARACTER_NAMES } from "./characters";
import { ChildAvatar } from "./ChildAvatar";
import { AVATAR_POSES, childLabel, POSE_NAMES, type ChildAvatar as Avatar } from "./children";
import { childDeviceLinkNote } from "./copy";
import { useFamily } from "./FamilyProvider";
import {
  grownUpLabel,
  lastSeenPhrase,
  type DeviceKind,
  type DeviceLink,
  type DeviceRow,
  type FamilyGrownUp,
} from "./people";
import { addGrownUp, refreshFamily, removeGrownUp, updateGrownUp } from "./store";
import { linkNeedsRelayStep, reachableLink, RELAY_FOOTER, type RelayStatus } from "./relay";

import "./people.css";

const DEVICES_REFRESH_MS = 3_000;

/** The grown-ups: who can say yes from their own phone. */
export function GrownUpsGroup() {
  const { profile, requireParentCode } = useFamily();
  const [editing, setEditing] = useState<{ readonly person: FamilyGrownUp | null } | null>(null);
  const open = (person: FamilyGrownUp | null) =>
    void requireParentCode("manageChildren").then((ok) => {
      if (ok) setEditing({ person });
    });
  return (
    <>
      <SettingsGroup
        title="Grown-ups"
        footer="The grown-ups in the family. Each can link their own phone to answer “Ask a grown-up” with Face ID or the parent code. There is still one parent code for everyone."
      >
        {profile.grownUps.map((person, index) => {
          const phones = profile.devices.filter(
            (device) => device.kind === "grown-up" && device.personId === person.id,
          ).length;
          return (
            <ListRow
              key={person.id}
              leading={<ChildAvatar child={person} size={32} />}
              title={grownUpLabel(person, index)}
              subtitle={
                phones === 0
                  ? "No phone linked"
                  : phones === 1
                    ? "1 phone linked"
                    : `${phones} phones linked`
              }
              trailing={
                <Button size="sm" onClick={() => open(person)}>
                  Edit…
                </Button>
              }
            />
          );
        })}
        {profile.grownUps.length < MAX_GROWN_UPS ? (
          <ListRow
            leading={<StepBadge state="todo" icon={Plus} />}
            title="Add a grown-up"
            subtitle="Another parent or carer who answers requests from their own phone."
            trailing={
              <Button size="sm" onClick={() => open(null)}>
                Add…
              </Button>
            }
          />
        ) : null}
      </SettingsGroup>
      {editing ? (
        <GrownUpSheet
          person={editing.person}
          canRemove={profile.grownUps.length > 1}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function GrownUpSheet({
  person,
  canRemove,
  onClose,
}: {
  readonly person: FamilyGrownUp | null;
  readonly canRemove: boolean;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(person?.name ?? "");
  const [avatar, setAvatar] = useState<Avatar>(person?.avatar ?? { kind: "mascot", pose: "hello" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = async () => {
    setBusy(true);
    const trimmed = name.trim() || null;
    const result =
      person === null
        ? await addGrownUp({ name: trimmed, avatar })
        : await updateGrownUp(person.id, { name: trimmed, avatar });
    setBusy(false);
    if (result.ok) onClose();
    else setProblem(result.message);
  };
  const remove = async () => {
    if (person === null) return;
    setBusy(true);
    const result = await removeGrownUp(person.id);
    setBusy(false);
    if (result.ok) onClose();
    else setProblem(result.message);
  };
  return (
    <Sheet
      open
      onClose={onClose}
      icon={UserRound}
      title={person === null ? "Add a grown-up" : `Edit ${person.name ?? "grown-up"}`}
      description="A first name for lists and requests, and a picture. Nothing else is kept."
      actions={
        confirmRemove ? (
          <>
            <Button onClick={() => setConfirmRemove(false)}>Keep</Button>
            <Button variant="destructive" filled disabled={busy} onClick={() => void remove()}>
              Remove and unlink their phones
            </Button>
          </>
        ) : (
          <>
            {person !== null && canRemove ? (
              <Button variant="destructive" onClick={() => setConfirmRemove(true)}>
                Remove…
              </Button>
            ) : null}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : person === null ? "Add" : "Save"}
            </Button>
          </>
        )
      }
    >
      <div className="fm-people-form">
        <TextField
          label="First name"
          value={name}
          maxLength={40}
          autoComplete="off"
          placeholder="Mum, Dad, Nana…"
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className="fm-people-poses" role="radiogroup" aria-label="Picture">
          {AVATAR_CHARACTERS.map((id) => {
            const chosen = avatar.kind === "character" && avatar.id === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={CHARACTER_NAMES[id]}
                className={`fm-people-pose${chosen ? " fm-people-pose--chosen" : ""}`}
                onClick={() => setAvatar({ kind: "character", id })}
              >
                <ChildAvatar child={{ avatar: { kind: "character", id }, name }} size={44} />
              </button>
            );
          })}
          {AVATAR_POSES.map((pose) => {
            const chosen = avatar.kind === "mascot" && avatar.pose === pose;
            return (
              <button
                key={pose}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={POSE_NAMES[pose]}
                className={`fm-people-pose${chosen ? " fm-people-pose--chosen" : ""}`}
                onClick={() => setAvatar({ kind: "mascot", pose })}
              >
                <ChildAvatar child={{ avatar: { kind: "mascot", pose }, name }} size={44} />
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={avatar.kind === "initial"}
            aria-label="Their first letter"
            className={`fm-people-pose${avatar.kind === "initial" ? " fm-people-pose--chosen" : ""}`}
            onClick={() => setAvatar({ kind: "initial", color: "grape" })}
          >
            <ChildAvatar child={{ avatar: { kind: "initial", color: "grape" }, name }} size={44} />
          </button>
        </div>
        {confirmRemove ? (
          <Banner tone="warning">
            Their linked phones stop working straight away. Their past answers stay in the recap.
          </Banner>
        ) : null}
        {problem ? <Banner tone="warning">{problem}</Banner> : null}
      </div>
    </Sheet>
  );
}

/** Every linked phone and iPad, with its person, kind and when it was last seen. */
export function DevicesGroup() {
  const { profile, requireParentCode } = useFamily();
  const [rows, setRows] = useState<ReadonlyArray<DeviceRow> | null>(null);
  const [linking, setLinking] = useState(false);
  const [removing, setRemoving] = useState<DeviceRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(
    () =>
      void familyApi.devices().then((result) => {
        if (result.ok) setRows(result.value);
        setNow(Date.now());
      }),
    [],
  );
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const personName = (row: Pick<DeviceRow, "kind" | "personId">) => {
    if (row.kind === "child") {
      const index = profile.children.findIndex((child) => child.id === row.personId);
      return index < 0 ? "Someone" : childLabel(profile.children[index]!, index);
    }
    const index = profile.grownUps.findIndex((person) => person.id === row.personId);
    return index < 0 ? "Someone" : grownUpLabel(profile.grownUps[index]!, index);
  };
  const startLink = () =>
    void requireParentCode("manageChildren").then((ok) => {
      if (ok) setLinking(true);
    });
  const askRemove = (row: DeviceRow) =>
    void requireParentCode("manageChildren").then((ok) => {
      if (ok) setRemoving(row);
    });
  const remove = async (row: DeviceRow) => {
    const result = await familyApi.removeDevice({ deviceId: row.id });
    setRemoving(null);
    if (result.ok) setRows(result.value);
    void refreshFamily();
  };
  return (
    <>
      <SettingsGroup
        title="Phones and iPads"
        footer="A child's device is always that child and shows only their own work, plus the fridge. A grown-up's phone can read everything and say yes or no, but can't send messages or change settings. Remove stops a device straight away."
      >
        {rows === null ? (
          <ListRow title="Checking…" />
        ) : rows.length === 0 ? (
          <ListRow
            leading={<StepBadge state="todo" icon={Laptop} />}
            title="Only this Mac so far"
            subtitle="Link a child's iPad so it opens straight to their own work, or a grown-up's phone to answer requests."
          />
        ) : (
          rows.map((row) => (
            <ListRow
              key={row.id}
              leading={
                <StepBadge
                  state={row.status === "linked" ? "ok" : "todo"}
                  icon={row.kind === "child" ? Tablet : Smartphone}
                />
              }
              title={
                <span className="fm-device-title">
                  {row.name}
                  {row.passkey || row.faceId ? (
                    <Pill tone="ok" size="sm">
                      Face ID
                    </Pill>
                  ) : null}
                  {row.watch ? (
                    <Pill tone="ok" size="sm">
                      Apple Watch
                    </Pill>
                  ) : null}
                </span>
              }
              subtitle={`${personName(row)} · ${deviceKindLabel(row.kind)} · ${lastSeenPhrase(row, now)}`}
              trailing={
                <Button
                  size="sm"
                  variant="destructive"
                  icon={Trash2}
                  onClick={() => askRemove(row)}
                >
                  Remove
                </Button>
              }
            />
          ))
        )}
        <ListRow
          leading={<StepBadge state="todo" icon={Plus} />}
          title="Link a phone or iPad…"
          subtitle="Shows a code to scan or type on the other device. It works once, for five minutes."
          trailing={
            <Button size="sm" variant="primary" onClick={startLink}>
              Link…
            </Button>
          }
        />
      </SettingsGroup>
      {linking ? (
        <LinkDeviceSheet
          onClose={() => {
            setLinking(false);
            refresh();
            void refreshFamily();
          }}
        />
      ) : null}
      <Sheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        icon={Trash2}
        iconTone="red"
        title={removing ? `Remove ${removing.name}?` : "Remove this device?"}
        description={
          removing?.kind === "grown-up"
            ? "It stops working straight away and forgets its Face ID. It can be linked again later with a new code."
            : "It stops working straight away. It can be linked again later with a new code. Nothing the child made is deleted."
        }
        sober
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button
              variant="destructive"
              filled
              onClick={() => (removing ? void remove(removing) : undefined)}
            >
              Remove
            </Button>
          </>
        }
      />
    </>
  );
}

type Person = {
  readonly kind: DeviceKind;
  readonly id: string;
  readonly label: string;
  readonly avatar: Avatar;
};

function LinkDeviceSheet({ onClose }: { readonly onClose: () => void }) {
  const { profile, requireParentCode } = useFamily();
  const people: ReadonlyArray<Person> = useMemo(
    () => [
      ...profile.children.map((child, index) => ({
        kind: "child" as const,
        id: child.id,
        label: childLabel(child, index),
        avatar: child.avatar,
      })),
      ...profile.grownUps.map((person, index) => ({
        kind: "grown-up" as const,
        id: person.id,
        label: grownUpLabel(person, index),
        avatar: person.avatar,
      })),
    ],
    [profile.children, profile.grownUps],
  );
  const [chosen, setChosen] = useState<Person | null>(people[0] ?? null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<DeviceLink | null>(null);
  const [linked, setLinked] = useState(false);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [addresses, setAddresses] = useState<ReadonlyArray<{
    label: string;
    reachable: boolean;
  }> | null>(null);
  const [checkingRoutes, setCheckingRoutes] = useState(true);
  const [routeProblem, setRouteProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const suggested =
    chosen === null ? "" : `${chosen.label}'s ${chosen.kind === "child" ? "iPad" : "phone"}`;

  const checkRoutes = useCallback(async () => {
    setCheckingRoutes(true);
    setRouteProblem(null);
    const [relay, routes] = await Promise.all([familyApi.relay(), familyApi.linkAddresses()]);
    if (relay.ok && routes.ok) {
      setRelayStatus(relay.value);
      setAddresses(routes.value);
    } else {
      setRouteProblem(
        !relay.ok
          ? relay.message
          : !routes.ok
            ? routes.message
            : "Couldn't check the link addresses.",
      );
    }
    setCheckingRoutes(false);
  }, []);

  useEffect(() => {
    void checkRoutes();
  }, [checkRoutes]);

  const turnOnRelay = async () => {
    if (!(await requireParentCode("manageChildren"))) return;
    setBusy(true);
    setProblem(null);
    const result = await familyApi.setRelay({ enabled: true });
    setBusy(false);
    if (result.ok) {
      setRelayStatus(result.value);
      if (addresses !== null && linkNeedsRelayStep(result.value, addresses)) {
        setProblem(
          "SKYCOT Relay could not be turned on. Try again, or use the home network option in Advanced Mode under Connections.",
        );
      }
    } else setProblem(result.message);
  };

  const needsRelayStep =
    relayStatus !== null && addresses !== null && linkNeedsRelayStep(relayStatus, addresses);

  // While the code is up: tick the countdown and watch for the other device to open it.
  useEffect(() => {
    if (link === null || linked) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void familyApi.devices().then((result) => {
        if (
          result.ok &&
          result.value.some((row) => row.id === link.deviceId && row.status === "linked")
        ) {
          setLinked(true);
        }
      });
    }, DEVICES_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [link, linked]);

  const create = async () => {
    if (chosen === null) return;
    setBusy(true);
    setProblem(null);
    const result = await familyApi.linkDevice({
      kind: chosen.kind,
      personId: chosen.id,
      name: name.trim() || suggested,
    });
    setBusy(false);
    if (result.ok) {
      setLink(result.value);
      setNow(Date.now());
    } else setProblem(result.message);
  };

  if (link !== null) {
    const best = reachableLink(link.links);
    const secondsLeft = Math.max(0, Math.round((link.expiresAt - now) / 1000));
    const expired = secondsLeft === 0 && !linked;
    return (
      <Sheet
        open
        onClose={onClose}
        icon={linked ? Check : chosen?.kind === "child" ? Tablet : Smartphone}
        title={linked ? "Linked" : `Link ${name.trim() || suggested}`}
        description={
          linked
            ? `${name.trim() || suggested} is ready. ${chosen ? deviceKindSummary(chosen.kind) : ""}`
            : "On the other device, open the camera and point it at this code, or open the link and type the code."
        }
        sober
        actions={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        {linked ? null : expired ? (
          <Banner tone="warning">This code has run out. Close this and make a new one.</Banner>
        ) : (
          <div className="fm-link">
            {best ? <QrImage value={best.url} /> : null}
            <div className="fm-link__code" aria-label="Code to type">
              {groupLinkCode(link.code)}
            </div>
            <p className="fm-help">
              Works once, for the next {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, "0")}.
            </p>
            {best ? <CopyLink url={best.url} /> : null}
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      icon={Smartphone}
      title="Link a phone or iPad"
      description="Who is it for? A child's device always opens as them. A grown-up's phone can answer requests."
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={
              busy || chosen === null || checkingRoutes || routeProblem !== null || needsRelayStep
            }
            onClick={() => void create()}
          >
            {busy ? "Making a code…" : "Show the code"}
          </Button>
        </>
      }
    >
      <div className="fm-people-form">
        {checkingRoutes ? (
          <p className="fm-help">Checking how a phone can reach this Mac…</p>
        ) : null}
        {routeProblem ? (
          <Banner tone="warning">
            {routeProblem}{" "}
            <Button size="sm" onClick={() => void checkRoutes()}>
              Try again
            </Button>
          </Banner>
        ) : null}
        {needsRelayStep ? (
          <div>
            {relayStatus?.available ? (
              <>
                <p>Phones need a way to reach this Mac. Turn on Reach this Mac from your phone?</p>
                <ul className="fm-relay-points">
                  <li>{RELAY_FOOTER}</li>
                </ul>
                <Button variant="primary" disabled={busy} onClick={() => void turnOnRelay()}>
                  {busy ? "Turning on…" : "Turn on and continue"}
                </Button>
              </>
            ) : (
              <ul className="fm-relay-points">
                <li>
                  SKYCOT Relay isn't available in this version. To link a phone, open Settings ›
                  Advanced Mode › Connections and allow other devices on your home network to reach
                  this Mac.
                </li>
              </ul>
            )}
          </div>
        ) : null}
        <List label="Who it's for">
          {people.map((person) => (
            <ListRow
              key={`${person.kind}:${person.id}`}
              leading={
                <ChildAvatar child={{ avatar: person.avatar, name: person.label }} size={32} />
              }
              title={person.label}
              subtitle={deviceKindLabel(person.kind)}
              selected={chosen?.id === person.id}
              trailing={chosen?.id === person.id ? <Check size={16} aria-hidden /> : null}
              onClick={() => setChosen(person)}
            />
          ))}
        </List>
        <TextField
          label="What is it called?"
          value={name}
          maxLength={40}
          autoComplete="off"
          placeholder={suggested}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        {chosen ? <p className="fm-help">{deviceKindSummary(chosen.kind)}</p> : null}
        {chosen?.kind === "child" ? <p className="fm-help">{childDeviceLinkNote}</p> : null}
        {problem ? <Banner tone="warning">{problem}</Banner> : null}
      </div>
    </Sheet>
  );
}

/** The link as a QR code, drawn here: nothing leaves this Mac to make it. */
function QrImage({ value }: { readonly value: string }) {
  const path = useMemo(() => {
    const code = QrCode.encodeText(value, QrCode.Ecc.LOW, false);
    const commands: Array<string> = [];
    for (let y = 0; y < code.size; y += 1) {
      for (let x = 0; x < code.size; x += 1) {
        if (code.getModule(x, y)) commands.push(`M${x + 4} ${y + 4}h1v1h-1z`);
      }
    }
    return { d: commands.join(""), size: qrImageSize(code.size) };
  }, [value]);
  return (
    <svg
      className="fm-link__qr"
      viewBox={`0 0 ${path.size} ${path.size}`}
      role="img"
      aria-label="QR code for the link"
      shapeRendering="crispEdges"
    >
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

function CopyLink({ url }: { readonly url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fm-link__url">
      <span className="fm-link__url-text">{url.replace(/#.*$/, "")}</span>
      <Button
        size="sm"
        icon={copied ? Check : Copy}
        onClick={() =>
          void navigator.clipboard?.writeText(url).then(
            () => setCopied(true),
            () => undefined,
          )
        }
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
      <p className="fm-help">
        This link works once for five minutes. It cannot be cleared from the clipboard.
      </p>
    </div>
  );
}

/** On a child's own device: whose it is, instead of the picker. */
export function ThisDeviceRow() {
  const { profile } = useFamily();
  if (profile.me.kind !== "child") return null;
  const childId = profile.me.childId;
  const index = profile.children.findIndex((child) => child.id === childId);
  const child = profile.children[index];
  const name = child ? childLabel(child, index) : "One child";
  return (
    <ListRow
      leading={
        child ? <ChildAvatar child={child} size={32} /> : <StepBadge state="ok" icon={Tablet} />
      }
      title={`${profile.me.deviceName} is ${name}'s`}
      subtitle="It always opens as them. A grown-up can change whose it is on the family's Mac."
    />
  );
}
