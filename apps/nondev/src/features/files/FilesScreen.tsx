// Files (`#/files/<environment>/<project>[/<conversation>]`): a calm, Finder-like list of one
// project's files, read-only. Folders open in place, any file opens in Quick Look. Noise
// (installed add-ons, build output, hidden and secret files) waits behind Show everything; with
// the Family profile on, the engine itself holds it until a grown-up enters the code, and keeps
// every path inside the project (skycot/files on the engine).
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { FILE_KIND_LABEL } from "@t3tools/skycot-rules/browse";
import { Atom } from "effect/reactivity";
import { ChevronLeft, ChevronRight, FileText, Folder, FolderOpen, Lock } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useChildView } from "../../app/useChildView";
import { navigate, threadHref } from "../../router";
import { projectAtomOrEmpty } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import { Banner } from "../../ui/Banner";
import { Button, IconButton } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { SearchField } from "../../ui/SearchField";
import { Switch } from "../../ui/Switch";
import { conversationTitle } from "../conversation/status";
import { useFamily } from "../family/FamilyProvider";
import { isNotTheirsMessage, returnHomeFromOwnershipRefusal } from "../family/ownership";
import { filesApi, type FilesPlace } from "./api";
import {
  crumbsOf,
  entryDetails,
  hiddenHere,
  kindOfEntry,
  entryOfHit,
  folderOfPath,
  parentOf,
  searchTerm,
  visibleEntries,
  SEARCH_SHOWN_CAP,
  type FilesEntry,
  type FilesListing,
  type SearchHit,
  type SearchResults,
} from "./model";
import { KIND_ICON } from "./icons";
import { QuickLook } from "./QuickLook";
import "./files.css";

// "changed 5 minutes ago" moves on by itself; a minute's clock is plenty.
const readMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const subscribeMinute = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
};

type Load =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly listing: FilesListing }
  | { readonly state: "refused"; readonly reason: string; readonly message: string };

type Found =
  | { readonly state: "idle" }
  | { readonly state: "looking" }
  | { readonly state: "done"; readonly term: string; readonly results: SearchResults }
  | { readonly state: "failed"; readonly message: string };

// Typing waits this long before the engine is asked, so a word is asked about once, not per letter.
const SEARCH_DELAY_MS = 250;

const NO_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("nondev-files:no-thread"),
);

export function FilesScreen({
  environmentId,
  projectId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | null;
}) {
  const project = useAtomValue(projectAtomOrEmpty({ environmentId, projectId }));
  const thread = useAtomValue(
    threadId === null
      ? NO_SHELL_ATOM
      : environmentThreadShells.threadShellAtom({ environmentId, threadId }),
  );
  const family = useFamily();
  const childView = useChildView();
  const now = useSyncExternalStore(subscribeMinute, readMinute, readMinute);
  const [path, setPath] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Found>({ state: "idle" });
  const [showEverything, setShowEverything] = useState(false);
  const [looking, setLooking] = useState<FilesEntry | null>(null);
  const place: FilesPlace = { projectId, threadId };

  // Bumped to read the folder again (after a grown-up's code opens Show everything).
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void filesApi.list({ projectId, threadId }, path).then((answer) => {
      if (cancelled) return;
      if (!answer.ok && isNotTheirsMessage(answer.message)) {
        returnHomeFromOwnershipRefusal(answer.message);
        return;
      }
      setLoad(
        answer.ok
          ? { state: "ready", listing: answer.value }
          : { state: "refused", reason: answer.reason, message: answer.message },
      );
    });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new version is a fresh read of the same folder.
  }, [projectId, threadId, path, version]);

  // Search the whole project (or the conversation's copy) a moment after typing stops. An answer
  // for an older word is dropped when a newer one was asked.
  const term = searchTerm(search);
  const [searchVersion, setSearchVersion] = useState(0);
  useEffect(() => {
    if (term === null) {
      setFound({ state: "idle" });
      return;
    }
    let stale = false;
    setFound({ state: "looking" });
    const timer = window.setTimeout(() => {
      void filesApi.search({ projectId, threadId }, term).then((answer) => {
        if (stale) return;
        if (!answer.ok && isNotTheirsMessage(answer.message)) {
          returnHomeFromOwnershipRefusal(answer.message);
          return;
        }
        setFound(
          answer.ok
            ? { state: "done", term, results: answer.value }
            : { state: "failed", message: answer.message },
        );
      });
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new version asks again after a grown-up opens Show everything.
  }, [projectId, threadId, term, searchVersion]);

  const listing = load.state === "ready" ? load.listing : null;
  const projectTitle = project?.title ?? "This project";
  const crumbs = crumbsOf(path, projectTitle);
  const hidden = listing === null ? 0 : hiddenHere(listing);
  // With the Family profile on, the engine holds noise until a grown-up says yes.
  const grownUpView = !family.enabled || listing?.noiseIncluded === true;
  const showingNoise = showEverything && grownUpView;
  const entries =
    listing === null
      ? []
      : visibleEntries(listing.entries, { showEverything: showingNoise, search: "" });

  const open = (to: string) => {
    setSearch("");
    if (to === path) return;
    setLoad({ state: "loading" });
    setPath(to);
  };
  const toggleEverything = async (on: boolean) => {
    if (!on) {
      setShowEverything(false);
      return;
    }
    if (family.enabled && listing?.noiseIncluded !== true) {
      if (!(await family.requireParentCode("seeAllFiles"))) return;
      setVersion((count) => count + 1);
      setSearchVersion((count) => count + 1);
    }
    setShowEverything(true);
  };

  const backToConversation =
    threadId === null ? null : () => navigate(threadHref(environmentId, threadId));

  return (
    <div className="fm-home fm-files">
      <div className="fm-home__inner fm-files__inner">
        <div className="fm-files__head">
          {backToConversation ? (
            <IconButton
              icon={ChevronLeft}
              label="Back to the conversation"
              onClick={backToConversation}
            />
          ) : null}
          <span className="fm-files__glyph" aria-hidden>
            <FolderOpen size={24} strokeWidth={1.7} />
          </span>
          <div className="fm-files__titles">
            <h2 className="fm-home__greeting">
              <span className="fm-marker-underline">Files</span>
            </h2>
            <p className="fm-home__sub">
              {listing?.privateCopy && thread
                ? `${projectTitle}, as “${conversationTitle(thread)}” left it (its private copy).`
                : `Everything in ${projectTitle}.`}{" "}
              Look as much as you like: nothing here changes or deletes a file.
            </p>
          </div>
        </div>

        <div className="fm-files__bar">
          <nav className="fm-files__crumbs" aria-label="Folder path">
            {path !== "" ? (
              <IconButton
                icon={ChevronLeft}
                size="sm"
                label="Up one folder"
                onClick={() => open(parentOf(path))}
              />
            ) : null}
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={crumb.path}>
                  {index > 0 ? (
                    <ChevronRight size={12} strokeWidth={2} aria-hidden className="fm-files__sep" />
                  ) : null}
                  {index === crumbs.length - 1 ? (
                    <span aria-current="location">{crumb.label}</span>
                  ) : (
                    <button type="button" onClick={() => open(crumb.path)}>
                      {crumb.label}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <div className="fm-files__tools">
            <div className="fm-files__search">
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Search files"
                label="Search files"
              />
            </div>
            <label className="fm-files__everything">
              {family.enabled && !grownUpView ? (
                <Lock size={12} strokeWidth={2} aria-hidden />
              ) : null}
              <span id="fm-files-everything">Show everything</span>
              <Switch
                checked={showingNoise}
                onChange={(on) => void toggleEverything(on)}
                label="Show everything"
                labelledBy="fm-files-everything"
              />
            </label>
          </div>
        </div>

        {load.state === "refused" ? (
          <Banner tone="warning">
            {load.message}
            {path !== "" ? (
              <>
                {" "}
                <Button size="sm" onClick={() => open("")}>
                  Back to the top
                </Button>
              </>
            ) : null}
          </Banner>
        ) : null}

        {term !== null ? (
          <SearchResultsList found={found} onOpen={(hit) => setLooking(entryOfHit(hit))} />
        ) : load.state === "loading" ? (
          <p className="fm-help">Looking…</p>
        ) : listing === null ? null : entries.length === 0 ? (
          <EmptyState icon={Folder} title={emptyTitle(listing)}>
            {hidden > 0 && !showingNoise ? "Only hidden files are in here." : null}
          </EmptyState>
        ) : (
          <ul
            className="fm-files__list"
            role="list"
            aria-label={`Files in ${crumbs.at(-1)!.label}`}
          >
            {entries.map((entry) => (
              <FileRow
                key={entry.path}
                entry={entry}
                now={now}
                childView={childView}
                onOpen={() => (entry.kind === "folder" ? open(entry.path) : setLooking(entry))}
              />
            ))}
          </ul>
        )}

        {listing !== null && term === null ? (
          <p className="fm-help fm-files__foot">
            {hidden > 0 && !showingNoise
              ? `${hidden === 1 ? "1 hidden item isn't" : `${hidden} hidden items aren't`} shown: add-ons, settings and secret files the project needs but nobody has to look at.`
              : listing.truncated
                ? "This folder is very full, so only the first 2,000 are shown."
                : "Files stay on this Mac."}
          </p>
        ) : null}
      </div>

      {looking ? (
        <QuickLook
          key={looking.path}
          entry={looking}
          now={now}
          place={place}
          environmentId={environmentId}
          grownUpView={grownUpView}
          onClose={() => setLooking(null)}
        />
      ) : null}
    </div>
  );
}

function emptyTitle(listing: FilesListing): string {
  return listing.path === "" ? "This project has no files yet" : "This folder is empty";
}

function SearchResultsList({
  found,
  onOpen,
}: {
  readonly found: Found;
  readonly onOpen: (hit: SearchHit) => void;
}) {
  if (found.state === "idle" || found.state === "looking") {
    return <p className="fm-help">Looking…</p>;
  }
  if (found.state === "failed") return <Banner tone="warning">{found.message}</Banner>;
  const { hits, truncated } = found.results;
  if (hits.length === 0) {
    return (
      <EmptyState icon={FileText} title={`No files match “${found.term}”`}>
        Try another word, or clear the search.
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="fm-files__list" role="list" aria-label={`Files matching ${found.term}`}>
        {hits.map((hit) => (
          <SearchRow key={hit.path} hit={hit} onOpen={() => onOpen(hit)} />
        ))}
      </ul>
      {truncated ? (
        <p className="fm-help fm-files__foot">
          Showing the first {Math.min(hits.length, SEARCH_SHOWN_CAP)}. Try a longer word to narrow
          it down.
        </p>
      ) : null}
    </>
  );
}

function SearchRow({ hit, onOpen }: { readonly hit: SearchHit; readonly onOpen: () => void }) {
  const kind = kindOfEntry({ name: hit.name, kind: "file" });
  const Icon = KIND_ICON[kind];
  const folder = folderOfPath(hit.path);
  return (
    <li className="fm-files__item">
      <button
        type="button"
        className="fm-files__row"
        onClick={onOpen}
        aria-label={`${hit.name}${folder === "" ? "" : `, in ${folder}`}, ${FILE_KIND_LABEL[kind]}`}
      >
        <span className={`fm-files__icon fm-files__icon--${kind}`} aria-hidden>
          <Icon size={18} strokeWidth={1.7} />
        </span>
        <span className="fm-files__text">
          <span className="fm-files__name">{hit.name}</span>
          <span className="fm-files__details">{folder === "" ? "Top of the project" : folder}</span>
          {hit.snippet !== null ? (
            <span className="fm-files__snippet">
              {hit.snippet.before}
              <mark>{hit.snippet.match}</mark>
              {hit.snippet.after}
            </span>
          ) : null}
        </span>
        <span className="fm-files__look">Look</span>
      </button>
    </li>
  );
}

function FileRow({
  entry,
  now,
  childView,
  onOpen,
}: {
  readonly entry: FilesEntry;
  readonly now: number;
  readonly childView: boolean;
  readonly onOpen: () => void;
}) {
  const kind = kindOfEntry(entry);
  const Icon = KIND_ICON[kind];
  return (
    <li className="fm-files__item">
      <button
        type="button"
        className={`fm-files__row${entry.noise ? " fm-files__row--noise" : ""}`}
        onClick={onOpen}
        aria-label={`${entry.name}, ${FILE_KIND_LABEL[kind]}`}
      >
        <span className={`fm-files__icon fm-files__icon--${kind}`} aria-hidden>
          <Icon size={18} strokeWidth={1.7} />
        </span>
        <span className="fm-files__text">
          <span className="fm-files__name">{entry.name}</span>
          <span className="fm-files__details">{entryDetails(entry, now, childView)}</span>
        </span>
        {entry.kind === "folder" ? (
          <ChevronRight size={14} strokeWidth={1.8} className="fm-files__chevron" aria-hidden />
        ) : (
          <span className="fm-files__look">Look</span>
        )}
      </button>
    </li>
  );
}
