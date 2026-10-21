import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";

import { App } from "./App";
import { applyPlatformClasses } from "./app/platform";
import { startThemeSync } from "./app/theme";
import { FAVICON_DATA_URI, PRODUCT_NAME } from "./brand";

function applyBranding() {
  document.title = PRODUCT_NAME;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = FAVICON_DATA_URI;
}

export const startup = Promise.resolve().then(() => {
  applyBranding();
  applyPlatformClasses();
  startThemeSync();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppAtomRegistryProvider>
        <App />
      </AppAtomRegistryProvider>
    </React.StrictMode>,
  );
});
