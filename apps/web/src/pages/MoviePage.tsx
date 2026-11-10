import { useEffect, useState } from "react";
import type { CatalogMovieDetails, Movie } from "@film-shelf/shared";
import { Link, useLocation, useParams } from "react-router";
import { FilmIcon } from "../components/FilmIcon";
import { MovieLoading } from "../components/MovieLoading";
import { ApiRequestError, getCatalogMovie, getMovie } from "../lib/api";
import { backNavigation, isPositiveId } from "../lib/navigation";
import { MovieDetailView } from "./MovieDetailView";

export function MovieRoute({ catalog = false }: { catalog?: boolean }) {
  const { id = "" } = useParams();
  return <MoviePage key={`${catalog ? "catalog" : "library"}-${id}`} id={id} catalog={catalog} />;
}

function MoviePage({ id, catalog }: { id: string; catalog: boolean }) {
  const location = useLocation();
  const [movie, setMovie] = useState<Movie | CatalogMovieDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    document.title = "电影详情 · Film Shelf";
    setLoading(true);
    setError(null);
    setNotFound(false);
    setMovie(null);
    if (!isPositiveId(id)) {
      setNotFound(true);
      setLoading(false);
      return () => controller.abort();
    }
    const request = catalog ? getCatalogMovie(id, controller.signal) : getMovie(id, controller.signal);
    request.then((result) => {
      if (!controller.signal.aborted) { setMovie(result); document.title = `${result.title} · Film Shelf`; }
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiRequestError && failure.status === 404) setNotFound(true);
      else setError(failure instanceof Error ? failure.message : "电影详情暂时无法载入，请稍后重试。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, catalog, revision]);

  const status = movie && ("status" in movie ? movie.status : movie.libraryStatus);
  const back = backNavigation(location, status === "watched" ? "/#recently-watched" : "/");
  if (notFound) return <section className="empty-state"><FilmIcon /><h1>没有找到这部电影</h1><p>电影资料可能不存在，请返回继续浏览。</p><Link className="outline-button" to={back.to} state={back.state}>{back.label}</Link></section>;
  if (error) return <section className="empty-state" role="alert"><FilmIcon /><h1>电影详情暂时无法载入</h1><p>{error}</p><button type="button" className="outline-button" onClick={() => setRevision((value) => value + 1)}>重新加载</button><Link className="outline-button" to={back.to} state={back.state}>{back.label}</Link></section>;
  if (loading || !movie) return <MovieLoading />;
  return <MovieDetailView movie={movie} backTo={back.to} backState={back.state} backLabel={back.label} />;
}
