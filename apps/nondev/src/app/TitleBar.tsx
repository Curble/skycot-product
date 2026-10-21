import { PanelLeft } from "lucide-react";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "../brand";
import { IconButton } from "../ui/Button";
import { SearchField } from "../ui/SearchField";
import { useShellState } from "./ShellState";
import type { Columns } from "./useColumns";

/**
 * The window's caption strip. Draggable in Electron (CSS app-region), with
 * insets for the native traffic lights / overlay buttons from app/platform.ts.
 */
export function TitleBar({
  columns,
  detail,
  trailing,
}: {
  readonly columns: Columns;
  /** "› Little Fern Café website" */
  readonly detail?: string | null;
  /** Pills at the right: provider, linked phone. */
  readonly trailing?: ReactNode;
}) {
  const shell = useShellState();
  return (
    <header className="fm-titlebar">
      {columns < 3 ? (
        <IconButton
          icon={PanelLeft}
          label="Show sidebar"
          onClick={() => shell.setDrawerOpen(true)}
          aria-expanded={shell.drawerOpen}
        />
      ) : null}
      <h1 className="fm-titlebar__title">
        {PRODUCT_NAME}
        {detail ? <span> › {detail}</span> : null}
      </h1>
      <span className="fm-titlebar__spacer" />
      {trailing}
      <div className="fm-titlebar__search">
        <SearchField
          value={shell.search}
          onChange={shell.setSearch}
          placeholder="Search conversations"
          label="Search conversations"
        />
      </div>
    </header>
  );
}
