// Settings › Family › "Pages allowed to use the internet": every page a grown-up let load
// pictures, sounds or data from internet sites, with the sites. Removing one needs no code (it
// only makes the profile stricter); the engine keeps the list.
import { Globe } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { SettingsGroup } from "../settings/SettingsGroup";
import { pageName, sitesSentence } from "../page-internet/PageInternetAsk";
import { useFamily } from "./FamilyProvider";
import { stopPageInternet } from "./store";

/** "pets › dog.html": the page's folder and name, never the whole path. */
export function pagePlace(page: string): string {
  const parts = page.split("/").filter((part) => part !== "");
  return parts.length > 1 ? `${parts.at(-2)} › ${pageName(page)}` : pageName(page);
}

export function PageInternetGroup() {
  const { profile } = useFamily();
  const [removing, setRemoving] = useState<string | null>(null);
  if (profile.pageInternet.length === 0) return null;
  return (
    <SettingsGroup
      title="Pages allowed to use the internet"
      footer="Each page gets pictures, sounds, fonts and data only from the sites listed, never scripts. Removing one makes the page offline again."
    >
      {profile.pageInternet.map((entry) => (
        <ListRow
          key={entry.page}
          leading={<StepBadge state="ok" icon={Globe} />}
          title={pagePlace(entry.page)}
          subtitle={sitesSentence(entry.sites)}
          trailing={
            <Button
              size="sm"
              disabled={removing !== null}
              onClick={() => {
                setRemoving(entry.page);
                void stopPageInternet(entry.page).finally(() => setRemoving(null));
              }}
            >
              {removing === entry.page ? "Removing…" : "Remove"}
            </Button>
          }
        />
      ))}
    </SettingsGroup>
  );
}
