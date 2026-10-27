// Settings › Family: the two lists that decide which projects the children see.
// "Put away" holds projects a child (or a grown-up) set aside; Bring back shows them again.
// "Developer projects" are code folders SKYCOT keeps out of the children's lists; the switch
// shows one to them. The engine decides who may do either, so a child's device can't.
import { useAtomValue } from "@effect/atom-react";
import { Archive, Code2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { Switch } from "../../ui/Switch";
import { environmentProjects } from "../../state/projects";
import { SettingsGroup } from "../settings/SettingsGroup";
import { useFamily } from "./FamilyProvider";
import { bringBackProject, setProjectForKids } from "./store";

export function PutAwayGroup() {
  const { profile } = useFamily();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const [busy, setBusy] = useState<string | null>(null);
  if (profile.projectArchives.length === 0) return null;
  return (
    <SettingsGroup
      title="Put away"
      footer="Nothing is deleted. A put-away project and its conversations are hidden from the children until you bring it back."
    >
      {profile.projectArchives.map((entry) => {
        const title =
          projects.find((project) => project.id === entry.projectId)?.title ?? "A project";
        const who =
          entry.by === "child"
            ? `Put away by ${profile.children.find((child) => child.id === entry.childId)?.name ?? "a child"}`
            : "Put away by a grown-up";
        return (
          <ListRow
            key={entry.projectId}
            leading={<StepBadge state="todo" icon={Archive} />}
            title={title}
            subtitle={who}
            trailing={
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  setBusy(entry.projectId);
                  void bringBackProject(entry.projectId).finally(() => setBusy(null));
                }}
              >
                {busy === entry.projectId ? "Bringing back…" : "Bring back"}
              </Button>
            }
          />
        );
      })}
    </SettingsGroup>
  );
}

export function ForTheKidsGroup() {
  const { profile } = useFamily();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const [busy, setBusy] = useState<string | null>(null);
  // Hidden code projects, plus any already shown (so the switch can be turned off again).
  const listed = projects.filter((project) => profile.developerProjects.includes(project.id));
  if (listed.length === 0) return null;
  return (
    <SettingsGroup
      title="Developer projects"
      footer="Folders with code in them stay out of the children's lists. Show one to the kids and they can open and work in it."
    >
      {listed.map((project) => {
        const shown = profile.kidsVisibleProjects.includes(project.id);
        return (
          <ListRow
            key={project.id}
            leading={<StepBadge state={shown ? "ok" : "todo"} icon={Code2} />}
            title={project.title}
            subtitle={shown ? "Shown to the kids" : "Hidden from the kids"}
            trailing={
              <Switch
                checked={shown}
                disabled={busy !== null}
                label={`Show ${project.title} to the kids`}
                onChange={(visible) => {
                  setBusy(project.id);
                  void setProjectForKids(project.id, visible).finally(() => setBusy(null));
                }}
              />
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
