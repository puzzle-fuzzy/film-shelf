import { useEffect, useState } from "react";
import type { ActorMovieList, ActorSummary } from "@film-shelf/shared";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { ActorPhoto } from "../components/ActorPhoto";
import { ActorWorksSkeleton } from "../components/ActorLoading";
import { FilmIcon } from "../components/FilmIcon";
import { Poster } from "../components/Poster";
import { ApiRequestError, getActorMovies } from "../lib/api";
import { actorMoviePath, actorPageSearch, backNavigation, isPositiveId, mediaTypeFromSearch, movieDetailLink, pageFromSearch, providerFromSearch } from "../lib/navigation";
import "../detail.css";
import "../actor.css";

export function ActorRoute() {
  const { id = "" } = useParams();
  const location = useLocation();
  const provider = providerFromSearch(new URLSearchParams(location.search)) || "tmdb";
  return <ActorPage key={`${provider}:${id}`} id={id} />;
}

interface ActorRequestResult {
  query: string;
  data: ActorMovieList | null;
  error: string | null;
  notFound: boolean;
}

function ActorPage({ id }: { id: string }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFromSearch(searchParams);
  const mediaType = mediaTypeFromSearch(searchParams) || "movie";
  const provider = providerFromSearch(searchParams);
  const [actor, setActor] = useState<ActorSummary | null>(null);
  const [result, setResult] = useState<ActorRequestResult | null>(null);
  const [revision, setRevision] = useState(0);
  const query = `${location.key}:${mediaType}:${page}:${revision}`;
  const current = result?.query === query ? result : null;
  const data = current?.data || null;
  const loading = !current;
  const error = current?.error;
  const notFound = current?.notFound;
  const back = backNavigation(location);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 24)));

  useEffect(() => { document.title = actor ? `${actor.name}的参演作品 · Film Shelf` : "参演作品 · Film Shelf"; }, [actor]);

  useEffect(() => {
    const controller = new AbortController();
    if (!isPositiveId(id)) {
      setResult({ query, data: null, error: null, notFound: true });
      return () => controller.abort();
    }
    getActorMovies(id, page, controller.signal, mediaType, provider).then((result) => {
      if (controller.signal.aborted) return;
      setActor(result.actor);
      const finalPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > finalPage) changePage(finalPage, true);
      else setResult({ query, data: result, error: null, notFound: false });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiRequestError && failure.status === 404) setResult({ query, data: null, error: null, notFound: true });
      else setResult({ query, data: null, error: failure instanceof Error ? failure.message : "参演作品暂时无法载入，请稍后重试。", notFound: false });
    });
    return () => controller.abort();
  }, [id, page, mediaType, provider, query]);

  function changePage(nextPage: number, replace = false) {
    const next = actorPageSearch(mediaType, nextPage, provider);
    setSearchParams(next, { replace, state: location.state });
  }

  return <section className={`actor-page${!actor && loading ? " actor-loading" : ""}`}>
    <Link to={back.to} state={back.state} className="detail-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg>
      {back.label}
    </Link>
    <div className="page-heading actor-page-heading">
      <div className="actor-identity">
        {actor ? <ActorPhoto src={actor.profileUrl} name={actor.name} priority /> : loading ? <span className="actor-photo-skeleton" aria-hidden="true" /> : null}
        <div><h1>{actor?.name || "参演作品"}</h1>{actor && <p>参演作品</p>}</div>
      </div>
      <span className="movie-count" role="status">{data ? `${data.total} 部作品` : loading ? "载入中…" : ""}</span>
    </div>
    <fieldset className="media-filter actor-media-filter"><legend>参演类型</legend>{(["movie", "tv"] as const).map((value) => <label key={value}><input type="radio" name="actor-media-type" checked={mediaType === value} onChange={() => { setSearchParams(actorPageSearch(value, 1, provider), { state: location.state }); }} />{value === "tv" ? "电视剧" : "电影"}</label>)}</fieldset>
    <div className="library" aria-label={actor ? `${actor.name}的参演作品` : "参演作品"} aria-busy={loading}>
      {notFound ? <div className="empty-state"><FilmIcon /><h2>没有找到这位演员</h2><p>演员资料可能不存在，请返回继续浏览。</p></div> : error ? <div className="empty-state" role="alert"><FilmIcon /><h2>参演作品暂时无法载入</h2><p>{error}</p><button type="button" className="outline-button" onClick={() => setRevision((value) => value + 1)}>重新加载</button></div> : loading ? <ActorWorksSkeleton /> : data?.movies.length ? <div className="movie-grid">{data.movies.map((movie, index) => {
        const pathname = actorMoviePath(movie, mediaType);
        if (!pathname) return null;
        return <Link
        className="movie-card actor-movie-card"
        key={pathname}
        to={movieDetailLink(pathname, location)}
      >
        <Poster src={movie.posterUrl} title={movie.title} variants={movie.posterVariants} priority={index === 0} decorative />
        <span className="card-title">{movie.title}</span>
        <span className="card-year"><span className="media-badge">{mediaType === "tv" ? "电视剧" : "电影"}</span> {movie.releaseDate?.slice(0, 4) || (mediaType === "tv" ? "首播日期未知" : "上映日期未知")}</span>
        {movie.libraryStatus === "watched" && <span className="actor-library-status watched">已观影</span>}
        {movie.character && <span className="actor-card-role">饰 {movie.character}</span>}
      </Link>; })}</div> : <div className="empty-state"><FilmIcon /><h2>暂无参演作品</h2><p>暂时没有这位演员的参演作品资料。</p></div>}
    </div>
    {data && pages > 1 && !loading && !error && <nav className="pagination" aria-label="参演作品分页"><button type="button" className="outline-button" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</button><span>第 {page} / {pages} 页</span><button type="button" className="outline-button" disabled={page >= pages} onClick={() => changePage(page + 1)}>下一页</button></nav>}
  </section>;
}
