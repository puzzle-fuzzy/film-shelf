import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { recentAnchor } from "./pages/HomePage";
import "./styles.css";

const { pathname, search, hash } = window.location;
const base = import.meta.env.BASE_URL;
const isHome = pathname === base || `${pathname}/` === base;
const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;

if (isHome && navigation?.type === "reload") {
  // Keep the router's scroll-to-top on reload instead of restoring the previous offset.
  window.history.scrollRestoration = "manual";
  if (hash === recentAnchor) {
    window.history.replaceState(window.history.state, "", pathname + search);
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
