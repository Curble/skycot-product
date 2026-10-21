import { Bell, Users } from "lucide-react";

import { EmptyState } from "../../ui/EmptyState";

/** Placeholder screens behind the Automations and People sidebar items. */
export function AutomationsScreen() {
  return (
    <div className="fm-home">
      <div className="fm-home__inner">
        <EmptyState icon={Bell} title="Automations are coming">
          Jobs that run on a schedule — a Monday booking summary, a nightly check — will live here.
        </EmptyState>
      </div>
    </div>
  );
}

export function PeopleScreen() {
  return (
    <div className="fm-home">
      <div className="fm-home__inner">
        <EmptyState icon={Users} title="People are coming">
          Your developer or a colleague who reviews work before it goes live will appear here.
        </EmptyState>
      </div>
    </div>
  );
}
