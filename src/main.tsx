import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Home-screen apps on iOS stay open for days, so a new version would otherwise wait for a full restart.
// Check for an update whenever the app comes back to the foreground, and reload once it takes over.
if ("serviceWorker" in navigator) {
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller; // skip the reload on the very first install
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    window.location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => { /* offline */ });
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
