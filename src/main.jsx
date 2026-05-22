import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { HashRouter } from "react-router-dom";
import { createIcons, icons } from "lucide";
import { store, persistor } from "./store";
import App from "./App";
import { redirectAwsOriginToCanonicalHost } from "./lib/canonicalHost";

import "./theme.css";
import "./pages/cashier/cashier.css";

if (!redirectAwsOriginToCanonicalHost()) {
  // Lucide was previously loaded from unpkg at runtime, which made a kiosk
  // on flaky wifi (or offline) show "Loading…" forever. Bundle it locally
  // and expose the global window.lucide that <Icon> already expects.
  //
  // Important: the ES-module build of lucide does NOT auto-register icons
  // the way the CDN <script> tag did. We have to pass the full `icons` map
  // into every createIcons() call. Wrapping it once here keeps Icon.jsx
  // unchanged and gives every <Icon name="..."> access to every icon.
  if (typeof window !== "undefined") {
    window.lucide = {
      createIcons: (opts = {}) => createIcons({ icons, ...opts }),
      icons,
    };
  }

  // HashRouter (not BrowserRouter): kiosk address bar is hidden, hash routes
  // work offline / in Electron / in WebView identically, and never hit the
  // server. URL becomes localhost:5173/#/sell, #/checkin, etc.
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <HashRouter>
            <App />
          </HashRouter>
        </PersistGate>
      </Provider>
    </React.StrictMode>
  );
}
