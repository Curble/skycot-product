/** A fresh random id for commands, conversations and messages (Node and tests). */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
