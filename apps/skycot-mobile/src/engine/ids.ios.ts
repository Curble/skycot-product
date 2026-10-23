import { randomUUID } from "expo-crypto";

/** A fresh random id for commands, conversations and messages (the system's secure random). */
export function newId(): string {
  return randomUUID();
}
