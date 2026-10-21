import type { ReactNode } from "react";

/** A keyboard key, e.g. <Kbd>⇧</Kbd><Kbd>Return</Kbd>. */
export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="fm-kbd">{children}</kbd>;
}
