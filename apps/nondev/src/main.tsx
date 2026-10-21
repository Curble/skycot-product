import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { App } from "./App";

export const startup = Promise.resolve().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppAtomRegistryProvider>
        <App />
      </AppAtomRegistryProvider>
    </React.StrictMode>,
  );
});
