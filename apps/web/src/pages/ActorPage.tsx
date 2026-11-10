import { useEffect, useState } from "react";
import type { ActorMovieList, MovieStatus } from "@film-shelf/shared";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { ActorPhoto } from "../components/ActorPhoto";
import { FilmIcon } from "../components/FilmIcon";
import { Poster } from "../components/Poster";
import { ApiRequestError, getActorMovies } from "../lib/api";
import { backNavigation, isPositiveId, movieDetailLink, pageFromSearch } from "../lib/navigation";
import "../detail.css";
import "../actor.css";

export function ActorRoute() {
  const { id = "" } = useParams();
  return <ActorPage key={id} id={id} />;
}

function ActorPage({ id }: { id: string }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFromSearch(searchParams);
  const [data, setData] = useState<ActorMovieList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [revision, setRevision] = useState(0);
  const back = backNavigation(location);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 24)));

  useEffect(() => {
    const controller = new AbortController();
    document.title = "参演电影 · Film Shelf";
    setLoading(true);
    setError(null);
    setNotFound(false);
    setData(null);
    if (!isPositiveId(id)) {
      setNotFound(true);
      setLoading(false);
      return () => controller.abort();
    }
    getActorMovies(id, page, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const finalPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > finalPage) changePage(finalPage, true);
      else { setData(result); document.title = `${result.actor.name}的参演电影 · Film Shelf`; }
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiRequestError && failure.status === 404) setNotFound(true);
      else setError(failure instanceof Error ? failure.message : "参演电影暂时无法载入，请稍后重试。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, revision]);

  function changePage(nextPage: number, replace = false) {
    const next = new URLSearchParams();
    if (nextPage !== 1) next.set("page", String(nextPage));
    setSearchParams(next, { replace, state: location.state });
  }

  return <section className="actor-page">
    <Link to={back.to} state={back.state} className="detail-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg>
      {back.label}
    </Link>
    <div className="page-heading actor-page-heading">
      <div className="actor-identity">
        {data ? <ActorPhoto src={data.actor.profileUrl} name={data.actor.name} /> : loading ? <span className="actor-photo-skeleton" aria-hidden="true" /> : null}
        <div><h1>{data?.actor.name || "参演电影"}</h1>{data && <p>参演电影</p>}</div>
      </div>
      <span className="movie-count" role="status">{data ? `${data.total} 部作品` : loading ? "载入中…" : ""}</span>
    </div>
    <div className="library" aria-label={data ? `${data.actor.name}的参演电影` : "参演电影"} aria-busy={loading}>
      {notFound ? <div className="empty-state"><FilmIcon /><h2>没有找到这位演员</h2><p>演员资料可能不存在，请返回继续浏览。</p></div> : error ? <div className="empty-state" role="alert"><FilmIcon /><h2>参演电影暂时无法载入</h2><p>{error}</p><button type="button" className="outline-button" onClick={() => setRevision((value) => value + 1)}>重新加载</button></div> : loading ? <div className="movie-grid" aria-label="正在载入参演电影">{Array.from({ length: 6 }, (_, index) => <div key={index} className="card-skeleton" aria-hidden="true"><span /><i /><i /></div>)}</div> : data?.movies.length ? <div className="movie-grid">{data.movies.map((movie, index) => <Link
        className="movie-card actor-movie-card"
        key={movie.tmdbId}
        to={movieDetailLink(movie.libraryMovieId ? `/movies/${movie.libraryMovieId}` : `/catalog/movies/${movie.tmdbId}`, location)}
      >
        <Poster src={movie.posterUrl} title={movie.title} variants={movie.posterVariants} priority={index === 0} decorative />
        <span className="card-title">{movie.title}</span>
        <span className="card-year">{movie.releaseDate?.slice(0, 4) || "上映日期未知"}</span>
        <span className={`actor-library-status ${movie.libraryStatus || "uncollected"}`}>{statusLabel(movie.libraryStatus)}</span>
        {movie.character && <span className="actor-card-role">饰 {movie.character}</span>}
      </Link>)}</div> : <div className="empty-state"><FilmIcon /><h2>暂无参演电影</h2><p>暂时没有这位演员的参演电影资料。</p></div>}
    </div>
    {data && pages > 1 && !loading && !error && <nav className="pagination" aria-label="参演电影分页"><button type="button" className="outline-button" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</button><span>第 {page} / {pages} 页</span><button type="button" className="outline-button" disabled={page >= pages} onClick={() => changePage(page + 1)}>下一页</button></nav>}
  </section>;
}

function statusLabel(status: MovieStatus | null) {
  return status === "watched" ? "已观影" : status === "recommended" ? "推荐" : "未收录";
}
