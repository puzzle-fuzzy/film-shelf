import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MediaType, MovieGridList, MovieStatus } from "@film-shelf/shared";
import { homeGridLayouts, homePosterPriorityCount } from "@film-shelf/shared/home-grid";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { FilmIcon } from "../components/FilmIcon";
import { Poster } from "../components/Poster";
import { getMovies } from "../lib/api";
import { homeLocation, mediaTypeFromSearch, movieDetailLink, pageFromSearch } from "../lib/navigation";

export const recentAnchor = "#recently-watched";

const layouts = homeGridLayouts.map(({ maxWidth, pageSize }) => ({
  media: maxWidth === null ? "all" : `(max-width: ${maxWidth}px)`,
  pageSize,
}));

function getPageSize() {
  return layouts.find(({ media }) => window.matchMedia(media).matches)?.pageSize ?? 12;
}

function subscribeToPageSize(onChange: () => void) {
  const queries = layouts.map(({ media }) => window.matchMedia(media));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

export function LegacyLibraryRedirect({ status }: { status: MovieStatus }) {
  const location = useLocation();
  const pageSize = useSyncExternalStore(subscribeToPageSize, getPageSize);
  const legacyPage = pageFromSearch(new URLSearchParams(location.search));
  const page = Math.min(1_000_000, (legacyPage - 1) * (24 / pageSize) + 1);
  const mediaType = mediaTypeFromSearch(new URLSearchParams(location.search));
  const to = status === "watched" ? homeLocation(1, page, recentAnchor, mediaType) : homeLocation(page, 1, "", mediaType);
  return <Navigate to={to} replace state={location.state} />;
}

export function HomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pageSize = useSyncExternalStore(subscribeToPageSize, getPageSize);
  const search = new URLSearchParams(location.search);
  const mediaType = mediaTypeFromSearch(search);
  const recommendedPage = pageFromSearch(search, "recommendedPage");
  const watchedPage = pageFromSearch(search, "watchedPage");
  const recommended = useShelf("recommended", recommendedPage, pageSize, mediaType);
  const watched = useShelf("watched", watchedPage, pageSize, mediaType);
  const finalRecommended = limitPage(recommendedPage, recommended.data);
  const finalWatched = limitPage(watchedPage, watched.data);
  const adjusting = finalRecommended !== recommendedPage || finalWatched !== watchedPage;
  const lastAnchor = useRef<string | null>(null);

  useEffect(() => { document.title = "Film Shelf · 我的片单"; }, []);

  useEffect(() => {
    if (adjusting) {
      navigate(homeLocation(finalRecommended, finalWatched, location.hash, mediaType), { replace: true, state: location.state });
    }
  }, [adjusting, finalRecommended, finalWatched, location.hash, location.state, mediaType, navigate]);

  useEffect(() => {
    if (location.hash !== recentAnchor) {
      lastAnchor.current = null;
      return;
    }
    if (adjusting || recommended.loading || watched.loading || lastAnchor.current === location.key) return;
    document.getElementById(recentAnchor.slice(1))?.scrollIntoView();
    lastAnchor.current = location.key;
  }, [adjusting, location.hash, location.key, recommended.loading, watched.loading]);

  return (
    <div className="home-shelves">
      <fieldset className="media-filter"><legend>作品类型</legend>{([undefined, "movie", "tv"] as const).map((value) => <label key={value || "all"}><input type="radio" name="shelf-media-type" checked={mediaType === value} onChange={() => navigate(homeLocation(1, 1, "", value), { state: location.state })} />{value === "tv" ? "电视剧" : value === "movie" ? "电影" : "全部"}</label>)}</fieldset>
      <MovieShelf status="recommended" shelf={recommended} page={recommendedPage} pageSize={pageSize}
        onPage={(page) => navigate(homeLocation(page, watchedPage, "", mediaType), { state: location.state })} />
      <MovieShelf status="watched" shelf={watched} page={watchedPage} pageSize={pageSize}
        onPage={(page) => navigate(homeLocation(recommendedPage, page, recentAnchor, mediaType), { state: location.state })} />
    </div>
  );
}

function limitPage(page: number, data: MovieGridList | undefined) {
  return data ? Math.min(page, Math.max(1, Math.ceil(data.total / data.pageSize))) : page;
}

interface ShelfResult {
  request: string;
  mediaType?: MediaType;
  data?: MovieGridList;
  error?: string;
}

function useShelf(status: MovieStatus, page: number, pageSize: number, mediaType?: MediaType) {
  const [result, setResult] = useState<ShelfResult | null>(null);
  const [revision, setRevision] = useState(0);
  const request = `${status}:${page}:${pageSize}:${mediaType || "all"}:${revision}`;
  const current = result?.request === request ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    getMovies(status, page, pageSize, controller.signal, mediaType).then((data) => {
      if (!controller.signal.aborted) setResult({ request, mediaType, data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setResult({ request, error: error instanceof Error ? error.message : "暂时无法载入片单，请稍后重试。" });
    });
    return () => controller.abort();
  }, [page, pageSize, mediaType, request, status]);

  return {
    data: current?.data,
    previous: !current && result?.mediaType === mediaType && result?.data?.pageSize === pageSize ? result.data : undefined,
    error: current?.error,
    loading: !current,
    retry: () => setRevision((value) => value + 1),
  };
}

function MovieShelf({ status, shelf, page, pageSize, onPage }: {
  status: MovieStatus;
  shelf: ReturnType<typeof useShelf>;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const location = useLocation();
  const watched = status === "watched";
  const title = watched ? "近日观影" : "想看";
  const Heading = watched ? "h2" : "h1";
  const sectionId = watched ? recentAnchor.slice(1) : "recommended";
  const { data, previous, error, retry } = shelf;
  const pages = Math.max(1, Math.ceil(((data ?? previous)?.total ?? 0) / pageSize));
  const loading = shelf.loading || (!!data && page > pages);
  const shown = loading ? previous : data;
  const shownPage = shown?.page ?? page;
  const from = { ...location, hash: watched ? recentAnchor : "" };
  const priorityPosterCount = watched ? 0 : homePosterPriorityCount(pageSize);

  return (
    <section className="home-shelf" id={sectionId} aria-labelledby={`${sectionId}-title`} aria-busy={loading}>
      <div className="page-heading">
        <Heading className="home-shelf-title" id={`${sectionId}-title`}>{title}</Heading>
        <span className="movie-count" role="status">{loading ? "载入中…" : data ? `${data.total} 部作品` : ""}</span>
      </div>
      {error ? (
        <div className="empty-state" role="alert">
          <FilmIcon /><h3>片单暂时无法载入</h3><p>{error}</p>
          <button type="button" className="outline-button" onClick={retry}>重新加载</button>
        </div>
      ) : loading && !shown ? (
        <div className="movie-grid" aria-label="正在载入影视">
          {Array.from({ length: pageSize }, (_, index) => <div key={index} className="card-skeleton" aria-hidden="true"><span /><i /><i /></div>)}
        </div>
      ) : shown?.movies.length ? (
        <div className={!watched && pages > 1 ? "movie-grid movie-grid-paged" : "movie-grid"} inert={loading}>
          {shown.movies.map((movie, index) => (
            <Link className="movie-card" key={movie.id} to={movieDetailLink(`/movies/${movie.id}`, from)}>
              <Poster
                src={movie.posterUrl}
                variants={movie.posterVariants}
                title={movie.title}
                priority={index < priorityPosterCount}
                decorative
              />
              <span className="home-card-caption">
                <span className="card-title">{movie.title}</span>
                <span className="card-year"><span className="media-badge">{movie.mediaType === "tv" ? "电视剧" : "电影"}</span> {movie.releaseDate?.slice(0, 4) || (movie.mediaType === "tv" ? "首播日期未知" : "上映日期未知")}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FilmIcon /><h3>{watched ? "还没有已观影的作品" : "还没有想看的作品"}</h3>
          <p>{watched ? "看过的作品会展示在这里。" : "想看的作品会展示在这里。"}</p>
        </div>
      )}
      {shown && pages > 1 && !error && (
        <nav className="pagination" aria-label={`${title}分页`}>
          <button type="button" className="outline-button" disabled={shownPage <= 1} aria-disabled={loading || undefined} onClick={() => { if (!loading) onPage(shownPage - 1); }}>上一页</button>
          <span>第 {shownPage} / {pages} 页</span>
          <button type="button" className="outline-button" disabled={shownPage >= pages} aria-disabled={loading || undefined} onClick={() => { if (!loading) onPage(shownPage + 1); }}>下一页</button>
        </nav>
      )}
    </section>
  );
}
