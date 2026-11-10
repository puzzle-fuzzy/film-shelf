import { useEffect, useState } from "react";
import type { CatalogMovieDetails, MediaType, Movie } from "@film-shelf/shared";
import { Link, useLocation, useParams } from "react-router";
import { FilmIcon } from "../components/FilmIcon";
import { MovieLoading } from "../components/MovieLoading";
import { ApiRequestError, getCatalogMovie, getMovie } from "../lib/api";
import { backNavigation, isPositiveId } from "../lib/navigation";
import { MovieDetailView } from "./MovieDetailView";

export function MovieRoute({ catalog = false, mediaType = "movie", provider = "tmdb" }: { catalog?: boolean; mediaType?: MediaType; provider?: "tmdb" | "douban" }) {
  const { id = "" } = useParams();
  return <MoviePage key={`${catalog ? "catalog" : "library"}-${provider}-${mediaType}-${id}`} id={id} catalog={catalog} mediaType={mediaType} provider={provider} />;
}

function MoviePage({ id, catalog, mediaType, provider }: { id: string; catalog: boolean; mediaType: MediaType; provider: "tmdb" | "douban" }) {
  const location = useLocation();
  const [movie, setMovie] = useState<Movie | CatalogMovieDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    document.title = "影视详情 · Film Shelf";
    setLoading(true);
    setError(null);
    setNotFound(false);
    setMovie(null);
    if (!isPositiveId(id)) {
      setNotFound(true);
      setLoading(false);
      return () => controller.abort();
    }
    const request = catalog ? getCatalogMovie(id, controller.signal, mediaType, provider) : getMovie(id, controller.signal);
    request.then((result) => {
      if (!controller.signal.aborted) { setMovie(result); document.title = `${result.title} · Film Shelf`; }
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiRequestError && failure.status === 404) setNotFound(true);
      else setError(failure instanceof Error ? failure.message : "影视详情暂时无法载入，请稍后重试。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, catalog, mediaType, provider, revision]);

  const status = movie && ("status" in movie ? movie.status : movie.libraryStatus);
  const back = backNavigation(location, status === "watched" ? "/#recently-watched" : "/");
  if (notFound) return <section className="empty-state"><FilmIcon /><h1>没有找到这部作品</h1><p>影视资料可能不存在，请返回继续浏览。</p><Link className="outline-button" to={back.to} state={back.state}>{back.label}</Link></section>;
  if (error) return <section className="empty-state" role="alert"><FilmIcon /><h1>影视详情暂时无法载入</h1><p>{error}</p><button type="button" className="outline-button" onClick={() => setRevision((value) => value + 1)}>重新加载</button><Link className="outline-button" to={back.to} state={back.state}>{back.label}</Link></section>;
  if (loading || !movie) return <MovieLoading />;
  return <MovieDetailView movie={movie} libraryMovieId={"libraryMovieId" in movie ? movie.libraryMovieId : movie.id} backTo={back.to} backState={back.state} backLabel={back.label} />;
}
