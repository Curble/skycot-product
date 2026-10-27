// "Things I made" (`#/makes`): the child's own makes as one list, newest first, each row a
// Workshop card that opens its conversation. Reached from the sidebar tab of the same name;
// the past makes no longer sit as rows in the sidebar itself.
import { ArrowLeft, Blocks } from "lucide-react";
import { useState } from "react";

import { childMakeBadge } from "../../app/Sidebar";
import { useChildMakes } from "../../app/useChildMakes";
import { HOME_HREF, navigate, threadHref } from "../../router";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Mascot } from "../brand/Mascot";

const FIRST_PAGE = 12;

export function MakesScreen({ showBack }: { readonly showBack: boolean }) {
  const rows = useChildMakes();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, FIRST_PAGE);
  return (
    <div className="fm-album-screen">
      <div className="fm-album-screen__inner">
        <header className="fm-album-head">
          {showBack ? (
            <Button icon={ArrowLeft} variant="quiet" size="sm" onClick={() => navigate(HOME_HREF)}>
              Back
            </Button>
          ) : null}
          <div className="fm-album-head__text">
            <h2 className="fm-album-head__title">Things I made</h2>
            <p className="fm-album-head__sub">
              {rows.length === 0
                ? "Nothing yet. Press Let's make to start something."
                : `${rows.length} ${rows.length === 1 ? "make" : "makes"} so far. Tap one to open it.`}
            </p>
          </div>
          <span className="fm-album-head__mascot" aria-hidden>
            <Mascot pose="hello" size={56} decorative />
          </span>
        </header>
        {rows.length === 0 ? (
          <EmptyState
            art={<Blocks size={40} strokeWidth={1.6} />}
            title="Your makes will show up here"
          />
        ) : (
          <ol className="fm-makes-list" aria-label="Things I made">
            {shown.map((row) => (
              <li key={row.shell.id}>
                <button
                  type="button"
                  className="fm-makes-row"
                  onClick={() => navigate(threadHref(row.shell.environmentId, row.shell.id))}
                >
                  <span className="fm-makes-row__title">{row.title}</span>
                  <small className="fm-makes-row__badge">
                    {childMakeBadge(row.status, row.at)}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        )}
        {rows.length > FIRST_PAGE ? (
          <div className="fm-makes-more">
            <Button variant="quiet" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer" : `Show all ${rows.length} makes`}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
