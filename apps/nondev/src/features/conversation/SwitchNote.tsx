// The plain line a conversation shows where SKYCOT moved a turn to another model because the one
// in use was resting: never an error card, never "limit reached". The engine keeps the switches
// (`/api/skycot/family/assistant-switches`, which answers with the Family profile on or off); a
// continuation it sent can also be read from the conversation itself (plain/switches.ts).
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { switchLine, parseAssistantSwitches, type AssistantSwitch } from "../../plain/switches";
import { serverEnvironment } from "../../state/server";
import { useCrew } from "../../themes/useCrew";
import { Bubble } from "../../ui/Bubble";
import { engineRequest } from "../family/api";
import { localTimeZone } from "../usage/useUsage";

const SWITCHES_PATH = "/api/skycot/family/assistant-switches";

const NO_PROVIDERS = Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(
  Atom.withLabel("nondev-switch-note-providers:empty"),
);

/**
 * The engine's switches for one conversation, by message id. Asked again whenever `refreshKey`
 * changes (the conversation's run count): a switch is recorded before its run exists.
 */
export function useAssistantSwitches(
  threadId: string,
  refreshKey: string,
): ReadonlyMap<string, AssistantSwitch> {
  const [switches, setSwitches] = useState<ReadonlyMap<string, AssistantSwitch>>(new Map());
  useEffect(() => {
    let live = true;
    // Asked again on every new run, when a new switch can have been recorded; the key rides in
    // the query (the engine ignores it), so no cache answers with an older list.
    const query = { threadId, runs: refreshKey };
    void engineRequest("GET", SWITCHES_PATH, undefined, parseAssistantSwitches, query).then(
      (result) => {
        if (!live || !result.ok) return;
        setSwitches(new Map(result.value.map((entry) => [entry.messageId, entry])));
      },
    );
    return () => {
      live = false;
    };
  }, [threadId, refreshKey]);
  return switches;
}

export function useEnvironmentProviders(
  environmentId: EnvironmentId | null,
): ReadonlyArray<ServerProvider> {
  return (
    useAtomValue(
      environmentId === null ? NO_PROVIDERS : serverEnvironment.providersValueAtom(environmentId),
    ) ?? []
  );
}

export function SwitchNote({
  change,
  providers,
}: {
  readonly change: AssistantSwitch;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const crew = useCrew();
  // Measured when the line first shows: "until Tuesday" stays put while it is on screen.
  const [now] = useState(() => Date.now());
  return (
    <Bubble author="crew" muted>
      {switchLine({
        change,
        providers,
        now,
        timeZone: localTimeZone(),
        crewName: crew.named ? crew.builder.name : null,
      })}
    </Bubble>
  );
}
