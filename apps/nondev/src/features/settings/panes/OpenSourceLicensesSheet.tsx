import {
  decodeThirdPartyLicenseManifest,
  filterThirdPartyLicenseEntries,
  formatLicenseBundles,
  thirdPartyLicenseEntryKey,
  type ThirdPartyLicenseEntry,
  type ThirdPartyLicenseManifest,
} from "@t3tools/shared/thirdPartyLicenses";
import { Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { advancedModeUrl } from "../../../app/platform";
import { ADVANCED_MODE_LABEL } from "../../../brand";
import { Button } from "../../../ui/Button";
import { SearchField } from "../../../ui/SearchField";
import { Sheet } from "../../../ui/Sheet";

type ManifestState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly manifest: ThirdPartyLicenseManifest };

/**
 * The stock client's build writes third-party-licenses.json beside its
 * index.html and the server serves that directory at the origin root, so the
 * same manifest the developer interface shows is one fetch away from /simple/
 * in every deployment (desktop, npx, hosted). Our own Vite dev server does not
 * emit it; the error state then points at the developer interface's page.
 */
function manifestUrl(): string {
  return `${advancedModeUrl()}third-party-licenses.json`;
}

let manifestPromise: Promise<ThirdPartyLicenseManifest> | undefined;

function loadManifest(): Promise<ThirdPartyLicenseManifest> {
  manifestPromise ??= fetch(manifestUrl(), { signal: AbortSignal.timeout(30_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`manifest request failed: ${String(response.status)}`);
      return decodeThirdPartyLicenseManifest((await response.json()) as unknown);
    })
    .catch((error: unknown) => {
      manifestPromise = undefined;
      throw error;
    });
  return manifestPromise;
}

const noticeStyle = {
  margin: "8px 0 4px",
  padding: "10px 12px",
  whiteSpace: "pre-wrap",
  fontFamily: "var(--fm-mono)",
  fontSize: 11,
  lineHeight: 1.5,
  maxHeight: "40vh",
  overflow: "auto",
  background: "var(--fm-bg-soft, rgba(0, 0, 0, 0.04))",
  borderRadius: 8,
} as const;

function LicenseEntryRow({ entry }: { readonly entry: ThirdPartyLicenseEntry }) {
  // The notice text (often a full licence) is only put in the DOM once the row
  // is opened; hundreds of hidden <pre> blocks would weigh down the sheet.
  const [open, setOpen] = useState(false);
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      style={{ padding: "6px 0", borderBottom: "1px solid var(--fm-separator, rgba(0,0,0,0.08))" }}
    >
      <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{entry.name}</span>
        {entry.version ? (
          <span style={{ fontFamily: "var(--fm-mono)", fontSize: 11, color: "var(--fm-label-3)" }}>
            {entry.version}
          </span>
        ) : null}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--fm-label)", flex: "none" }}>
          {entry.license} · {formatLicenseBundles(entry.bundles)}
        </span>
      </summary>
      {open ? (
        <>
          {entry.sourceUrl ? (
            <p style={{ margin: "6px 0 0", fontSize: 12 }}>
              Source:{" "}
              <a href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
                {entry.sourceUrl}
              </a>
            </p>
          ) : null}
          <pre style={noticeStyle}>{entry.noticeText}</pre>
        </>
      ) : null}
    </details>
  );
}

/** Fetches on mount and resets by unmounting: the sheet renders it only while open. */
function LicenseList() {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadManifest().then(
      (manifest) => {
        if (!cancelled) setState({ status: "ready", manifest });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(
    () =>
      state.status === "ready" ? filterThirdPartyLicenseEntries(state.manifest.entries, query) : [],
    [state, query],
  );

  if (state.status === "loading") {
    return <p style={{ margin: 0, color: "var(--fm-label)" }}>Loading the licence list…</p>;
  }
  if (state.status === "error") {
    return (
      <p style={{ margin: 0, color: "var(--fm-label)" }}>
        The licence list is not available from this address. It is always available in{" "}
        {ADVANCED_MODE_LABEL} under Settings › Open-source licences.
      </p>
    );
  }
  return (
    <>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search by name or licence"
        label="Search licences"
      />
      <p style={{ margin: "10px 0 4px", fontSize: 12, color: "var(--fm-label-3)" }}>
        {entries.length === state.manifest.entries.length
          ? `${String(entries.length)} components`
          : `${String(entries.length)} of ${String(state.manifest.entries.length)} components`}
      </p>
      <div
        role="list"
        aria-label="Open-source components"
        style={{ maxHeight: "55vh", overflow: "auto" }}
      >
        {entries.map((entry) => (
          <LicenseEntryRow key={thirdPartyLicenseEntryKey(entry)} entry={entry} />
        ))}
      </div>
    </>
  );
}

/** Every library the app is built from, with its licence text, in a calm sheet. */
export function OpenSourceLicensesSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={Scale}
      iconTone="grey"
      wide
      title="Open-source licences"
      description="The libraries, fonts and sounds this app is built from, each with the licence its authors chose. Open a row to read the full notice."
      actions={
        <>
          <Button
            onClick={() =>
              window.location.assign(`${advancedModeUrl()}settings/open-source-licenses`)
            }
          >
            Open in {ADVANCED_MODE_LABEL}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {open ? <LicenseList /> : null}
    </Sheet>
  );
}
