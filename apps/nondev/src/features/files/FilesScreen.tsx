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

import { useColumns } from "../../app/useColumns";
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
  parentOf,
  visibleEntries,
  type FilesEntry,
  type FilesListing,
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
  const columns = useColumns();
  const now = useSyncExternalStore(subscribeMinute, readMinute, readMinute);
  const [path, setPath] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [search, setSearch] = useState("");
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
      : visibleEntries(listing.entries, { showEverything: showingNoise, search });

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
                placeholder={columns === 1 ? "Find" : "Find in this folder"}
                label="Find in this folder"
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

        {load.state === "loading" ? (
          <p className="fm-help">Looking…</p>
        ) : listing === null ? null : entries.length === 0 ? (
          <EmptyState icon={search.trim() ? FileText : Folder} title={emptyTitle(search, listing)}>
            {search.trim()
              ? "Try another word, or clear the search."
              : hidden > 0 && !showingNoise
                ? "Only hidden files are in here."
                : null}
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

        {listing !== null ? (
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

function emptyTitle(search: string, listing: FilesListing): string {
  if (search.trim()) return `Nothing called “${search.trim()}” here`;
  return listing.path === "" ? "This project has no files yet" : "This folder is empty";
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
