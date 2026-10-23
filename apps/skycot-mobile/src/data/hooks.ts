/**
 * Small reading hooks for one screen at a time: a conversation (kept fresh every second and a
 * half while it is on screen), the fridge, the sticker book, a recap.
 */
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { familyApi, type FamilyResult } from "../family/api";
import { readThread } from "../engine/engine";
import type { ThreadProjection } from "../engine/types";
import type { Mac } from "../links/store";

export interface Loaded<A> {
  readonly value: A | null;
  readonly problem: string | null;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

function useEvery(run: () => Promise<void>, everyMs: number | null, deps: ReadonlyArray<unknown>) {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!focused || !active) return;
    void runRef.current();
    if (everyMs === null) return;
    const timer = setInterval(() => void runRef.current(), everyMs);
    return () => clearInterval(timer);
  }, [focused, active, everyMs, ...deps]);
}

export function useThread(mac: Mac | null, threadId: string): Loaded<ThreadProjection> {
  const [value, setValue] = useState<ThreadProjection | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (mac === null) return;
    try {
      setValue(await readThread(mac.transport, threadId));
      setProblem(null);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The conversation didn't load.");
    } finally {
      setLoading(false);
    }
  }, [mac, threadId]);
  useEvery(refresh, 1_500, [mac?.macId, threadId]);
  return { value, problem, loading, refresh };
}

export function useFamilyRead<A>(
  mac: Mac | null,
  read: ((mac: Mac) => Promise<FamilyResult<A>>) | null,
  everyMs: number | null,
  key: string,
): Loaded<A> {
  const [value, setValue] = useState<A | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const readRef = useRef(read);
  readRef.current = read;
  const refresh = useCallback(async () => {
    const current = readRef.current;
    if (mac === null || current === null) return;
    const result = await current(mac);
    if (result.ok) {
      setValue(result.value);
      setProblem(null);
    } else setProblem(result.message);
    setLoading(false);
  }, [mac]);
  useEvery(refresh, everyMs, [mac?.macId, key]);
  return { value, problem, loading, refresh };
}

export const readFridge = (mac: Mac) => familyApi.fridge(mac.transport);
export const readStickers = (mac: Mac) => familyApi.stickers(mac.transport);
