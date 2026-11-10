import { lazy, Suspense, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { HomePage, LegacyLibraryRedirect, recentAnchor } from "./pages/HomePage";
import { MovieLoading } from "./components/MovieLoading";
import { ActorLoading } from "./components/ActorLoading";
import { ThemeToggle } from "./components/ThemeToggle";

const MovieRoute = lazy(() => import("./pages/MoviePage").then(({ MovieRoute }) => ({ default: MovieRoute })));
const ActorRoute = lazy(() => import("./pages/ActorPage").then(({ ActorRoute }) => ({ default: ActorRoute })));

export default function App() {
  return (
    <div className="site-shell">
      <ScrollToTop />
      <PageScrollbars />
      <main className="main-content" id="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/recommended" element={<LegacyLibraryRedirect status="recommended" />} />
          <Route path="/watched" element={<LegacyLibraryRedirect status="watched" />} />
          <Route path="/movies/:id" element={<Suspense fallback={<MovieLoading />}><MovieRoute /></Suspense>} />
          <Route path="/catalog/movies/:id" element={<Suspense fallback={<MovieLoading />}><MovieRoute catalog /></Suspense>} />
          <Route path="/catalog/tv/:id" element={<Suspense fallback={<MovieLoading />}><MovieRoute catalog mediaType="tv" /></Suspense>} />
          <Route path="/catalog/douban/movies/:id" element={<Suspense fallback={<MovieLoading />}><MovieRoute catalog provider="douban" /></Suspense>} />
          <Route path="/catalog/douban/tv/:id" element={<Suspense fallback={<MovieLoading />}><MovieRoute catalog mediaType="tv" provider="douban" /></Suspense>} />
          <Route path="/actors/:id" element={<Suspense fallback={<ActorLoading />}><ActorRoute /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" aria-label="TMDB 影视资料来源"><img src={`${import.meta.env.BASE_URL}tmdb.svg`} width="64" height="8" loading="lazy" decoding="async" alt="TMDB" /></a>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </footer>
      <ThemeToggle />
    </div>
  );
}

function PageScrollbars() {
  useEffect(() => {
    let stopped = false;
    let dispose: (() => void) | undefined;
    let cancel: (() => void) | undefined;

    function load() {
      void Promise.all([
        import("@film-shelf/shared/scrollbars"),
        import("@film-shelf/shared/scrollbars.css"),
      ]).then(([{ mountOverlayScrollbars }]) => {
        if (!stopped) dispose = mountOverlayScrollbars();
      }).catch(() => {
        // The page remains scrollable if the optional enhancement is unavailable.
      });
    }

    function schedule() {
      if (typeof window.requestIdleCallback === "function") {
        const task = window.requestIdleCallback(load, { timeout: 1500 });
        cancel = () => window.cancelIdleCallback(task);
      } else {
        const task = window.setTimeout(load, 0);
        cancel = () => window.clearTimeout(task);
      }
    }

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      stopped = true;
      window.removeEventListener("load", schedule);
      cancel?.();
      dispose?.();
    };
  }, []);
  return null;
}

function ScrollToTop() {
  const { pathname, search, hash } = useLocation();
  const previousPath = useRef<string | null>(null);
  useEffect(() => {
    const stayingOnHome = pathname === "/" && previousPath.current === "/";
    previousPath.current = pathname;
    if (stayingOnHome || (pathname === "/" && hash === recentAnchor)) return;
    window.scrollTo(0, 0);
  }, [pathname, search, hash]);
  return null;
}
