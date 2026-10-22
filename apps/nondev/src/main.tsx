import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";

import { App } from "./App";
import { applyPlatformClasses, writeUiMode } from "./app/platform";
import { startThemeSync } from "./app/theme";
import { applyTextSize, readTextSize } from "./features/settings/localPrefs";
import { PRODUCT_NAME } from "./brand";
import { startDaylightBranding } from "./features/brand/useDaylightPhase";
import { ErrorBoundary } from "./ui/ErrorBoundary";

export const startup = Promise.resolve().then(() => {
  document.title = PRODUCT_NAME;
  // Tab icon: day or dusk drawing, switched at local civil dusk and dawn.
  startDaylightBranding();
  applyPlatformClasses();
  startThemeSync();
  applyTextSize(readTextSize());
  // Being here is choosing the simple interface; the stock UI reads this to
  // offer the way back.
  writeUiMode("simple");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppAtomRegistryProvider>
          <App />
        </AppAtomRegistryProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
