/**
 * A grown-up's phone, on each linked Mac: who this grown-up is, the children, and the requests
 * waiting. Everything here is read-only except Allow once / Decline, more time and Lock
 * everything, which go through the Mac's approver routes (WHO-IS-WHO, "The approval contract").
 */
import type { FamilyChild } from "../../../../nondev/src/features/family/children";
import { grownUpLabel } from "../../../../nondev/src/features/family/people";
import { useMacData } from "../../data/MacData";
import type { FamilyNote, PendingRequest } from "../../family/api";
import { useLinks, type Mac } from "../../links/store";

export interface WaitingRequest {
  readonly mac: Mac;
  readonly request: PendingRequest;
  readonly child: FamilyChild | null;
}

export interface WaitingFamilyNote {
  readonly mac: Mac;
  readonly note: FamilyNote;
  readonly child: FamilyChild | null;
}

export function useGrownUp() {
  const { macs } = useLinks();
  const { byMac } = useMacData();
  const nameOn = (mac: Mac): string => {
    const status = byMac[mac.macId]?.status;
    if (mac.me.kind !== "grown-up" || !status) return "Grown-up";
    const personId = mac.me.personId;
    const people = status.grownUps ?? [];
    const index = people.findIndex((person) => person.id === personId);
    return index < 0 ? "Grown-up" : grownUpLabel(people[index]!, index);
  };
  const childrenOn = (mac: Mac): ReadonlyArray<FamilyChild> =>
    byMac[mac.macId]?.status?.children ?? [];
  const waiting: Array<WaitingRequest> = macs.flatMap((mac) =>
    (byMac[mac.macId]?.requests ?? []).map((request) => ({
      mac,
      request,
      child: childrenOn(mac).find((child) => child.id === request.childId) ?? null,
    })),
  );
  waiting.sort((a, b) => b.request.createdAt - a.request.createdAt);
  const notes: Array<WaitingFamilyNote> = macs.flatMap((mac) =>
    (byMac[mac.macId]?.notes ?? [])
      .filter((note) => note.status === "open")
      .map((note) => ({
        mac,
        note,
        child: childrenOn(mac).find((child) => child.id === note.childId) ?? null,
      })),
  );
  notes.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
  return {
    macs,
    byMac,
    name: macs.length > 0 ? nameOn(macs[0]!) : "Grown-up",
    nameOn,
    childrenOn,
    waiting,
    notes,
    loaded: macs.every(
      (mac) => byMac[mac.macId]?.requests !== null && byMac[mac.macId]?.requests !== undefined,
    ),
  };
}
