import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, SourceControlDiscoveryResult } from "@t3tools/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Github, Users } from "lucide-react";

import { settingsHref } from "../../router";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { List, ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { gitHubStatusOf, sourceControlEnvironment } from "../settings/sourceControl";

const EMPTY_DISCOVERY_ATOM = Atom.make<
  AsyncResult.AsyncResult<SourceControlDiscoveryResult, unknown>
>(AsyncResult.initial()).pipe(Atom.withLabel("nondev-source-control-discovery:empty"));

/**
 * "Who can help": the GitHub account this Mac is signed in with is the one
 * reviews go through. The engine exposes no reviewer list, so this stays a
 * single calm row or an explanation of how to connect.
 */
export function PeopleScreen() {
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId: EnvironmentId | null = environmentIds[0] ?? null;
  const discovery = useAtomValue(
    environmentId === null
      ? EMPTY_DISCOVERY_ATOM
      : sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const result = Option.getOrNull(AsyncResult.value(discovery));
  const github = gitHubStatusOf(result);
  const accounts =
    result?.sourceControlProviders
      .find((entry) => entry.kind === "github")
      ?.auth.accounts?.filter((entry) => entry.authenticated) ?? [];

  return (
    <div className="fm-home">
      <div className="fm-home__inner">
        <div className="fm-screen-head">
          <div>
            <h2 className="fm-home__greeting">Who can help</h2>
            <p className="fm-home__sub">
              The people and accounts your work can be shared with for a second pair of eyes.
            </p>
          </div>
        </div>

        {environmentId === null || result === null ? (
          <EmptyState
            icon={Users}
            title={discovery._tag === "Failure" ? "Couldn't check" : "Looking…"}
          >
            {discovery._tag === "Failure"
              ? "Your Mac didn't answer. Try again in a moment."
              : "Asking your Mac which accounts are connected."}
          </EmptyState>
        ) : github?.signedIn ? (
          <List label="Connected accounts">
            {(accounts.length > 0
              ? accounts
              : [
                  {
                    account: github.account ?? "GitHub",
                    host: github.host ?? "github.com",
                    active: true,
                  },
                ]
            ).map((entry) => (
              <ListRow
                key={`${entry.host}:${entry.account}`}
                leading={
                  <Avatar kind="person" value={entry.account} size="md" label={entry.account} />
                }
                title={entry.account}
                subtitle={`GitHub${entry.host && entry.host !== "github.com" ? ` · ${entry.host}` : ""} · kept versions you send for review go here`}
                trailing={
                  entry.active ? (
                    <Pill tone="ok" size="sm" icon={Github}>
                      Connected
                    </Pill>
                  ) : null
                }
              />
            ))}
          </List>
        ) : (
          <EmptyState
            icon={Users}
            title="No one is connected yet"
            action={
              <Button
                variant="primary"
                onClick={() => (window.location.hash = settingsHref("sharing").slice(1))}
              >
                Connect GitHub in Settings
              </Button>
            }
          >
            Connect GitHub and your developer, or a colleague, can review a version before it goes
            live. It takes one command in Terminal; Settings → Sharing & review walks you through
            it.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
