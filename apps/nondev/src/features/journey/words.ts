import { BUILD_WORDS } from "./library";

type BuildWord = (typeof BUILD_WORDS)[number];

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

const BUILD_WORD_KEY = "skycot.build-words.v1";

function buildWords(): Record<string, BuildWord> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BUILD_WORD_KEY) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, BuildWord] =>
        BUILD_WORDS.some((word) => word === entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function readBuildWord(runId: string | null): BuildWord | null {
  return runId === null ? null : (buildWords()[runId] ?? null);
}

export function rememberBuildWord(runId: string, word: BuildWord): void {
  try {
    const saved = buildWords();
    if (Object.hasOwn(saved, runId)) return;
    localStorage.setItem(
      BUILD_WORD_KEY,
      JSON.stringify(Object.fromEntries(Object.entries({ ...saved, [runId]: word }).slice(-200))),
    );
  } catch {
    // With storage blocked, the mounted notebook still keeps its word for this run.
  }
}
