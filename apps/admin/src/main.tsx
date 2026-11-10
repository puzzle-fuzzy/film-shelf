import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { mountOverlayScrollbars } from "@film-shelf/shared/scrollbars";
import App from "./App";
import "@film-shelf/shared/scrollbars.css";
import "./index.css";

const disposeScrollbars = mountOverlayScrollbars({ nested: true });
import.meta.hot?.dispose(disposeScrollbars);

createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
