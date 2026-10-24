const key = (childId: string) => `skycot.words-known.v1.${childId}`;

export function readKnownWords(
  childId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): ReadonlyArray<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(key(childId)) ?? "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((word): word is string => typeof word === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function rememberWord(
  childId: string,
  word: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): ReadonlyArray<string> {
  try {
    const words = [...new Set([...readKnownWords(childId, storage), word])];
    storage.setItem(key(childId), JSON.stringify(words));
    return words;
  } catch {
    return readKnownWords(childId, storage);
  }
}
