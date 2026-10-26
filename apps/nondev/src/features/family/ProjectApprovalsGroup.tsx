import { FolderOpen } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { SettingsGroup } from "../settings/SettingsGroup";
import { useFamily } from "./FamilyProvider";
import { stopProjectApproval } from "./store";

const coverWords: Record<string, string> = {
  webSearch: "look things up on the internet",
  addOns: "install the add-ons this project needs",
  internetFetch: "fetch plain pages and data",
  internetAssets: "load pictures, sounds, fonts and data from allowed sites",
};

const folderName = (path: string) => path.split(/[\\/]/u).filter(Boolean).at(-1) ?? "project";

export function ProjectApprovalsGroup() {
  const { profile } = useFamily();
  const [removing, setRemoving] = useState<string | null>(null);
  if (profile.projectApprovalGrants.length === 0) return null;
  return (
    <SettingsGroup
      title="Project permissions"
      footer="These permissions last 30 days. Stop one at any time; the next matching step will ask again."
    >
      {profile.projectApprovalGrants.map((grant) => {
        const child = profile.children.find((entry) => entry.id === grant.childId);
        const childName = child?.name ?? "Your child";
        const covers = grant.covers
          .map((cover) => coverWords[cover])
          .filter(Boolean)
          .join("; ");
        return (
          <ListRow
            key={grant.id}
            leading={<StepBadge state="ok" icon={FolderOpen} />}
            title={`What ${childName} may do in ${folderName(grant.projectPath)}`}
            subtitle={covers}
            trailing={
              <Button
                size="sm"
                disabled={removing !== null}
                onClick={() => {
                  setRemoving(grant.id);
                  void stopProjectApproval(grant.id).finally(() => setRemoving(null));
                }}
              >
                {removing === grant.id ? "Stopping…" : "Stop"}
              </Button>
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
