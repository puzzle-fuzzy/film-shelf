import { useEffect, useRef, useState } from "react";
import type { MovieDetailData } from "@film-shelf/shared";
import { Link, useLocation } from "react-router";
import { ActorPhoto } from "../components/ActorPhoto";
import { DetailPoster } from "../components/DetailPoster";
import { nextNavigationState } from "../lib/navigation";
import "../detail.css";

export function MovieDetailView({ movie, backTo, backState, backLabel = "返回片单" }: { movie: MovieDetailData; backTo: string; backState?: unknown; backLabel?: string }) {
  const location = useLocation();
  const magnet = movie.magnetUrl && /^magnet:\?/i.test(movie.magnetUrl) ? movie.magnetUrl : null;
  const watchedDate = formatWatchedDate(movie.watchedAt);

  return (
    <article className="detail-page">
      <Link to={backTo} state={backState} className="detail-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg>
        {backLabel}
      </Link>
      <div className="detail-layout">
        <aside className="detail-poster-column" aria-label="影视海报">
          <DetailPoster key={movie.posterUrl} src={movie.posterUrl} title={movie.title} />
        </aside>
        <div className="detail-content">
          <header className="detail-introduction">
            <h1>{movie.title}</h1>
            <p className="detail-media-label"><span className="media-badge">{movie.mediaType === "tv" ? "电视剧" : "电影"}</span></p>
            {movie.originalTitle && movie.originalTitle !== movie.title && <p className="detail-original-title">{movie.originalTitle}</p>}
            <dl className="detail-facts">
              <div><dt>{movie.mediaType === "tv" ? "首播日期" : "上映日期"}</dt><dd>{movie.releaseDate || "暂无资料"}</dd></div>
              {movie.mediaType === "tv" && movie.episodeCount && <div><dt>集数</dt><dd>{movie.episodeCount} 集</dd></div>}
              {(Number.isSafeInteger(movie.tmdbId) && (movie.tmdbId || 0) > 0 || Number.isSafeInteger(movie.doubanId) && (movie.doubanId || 0) > 0) && <div><dt>资料来源</dt><dd className="detail-source-links">{Number.isSafeInteger(movie.tmdbId) && (movie.tmdbId || 0) > 0 && <a href={`https://www.themoviedb.org/${movie.mediaType === "tv" ? "tv" : "movie"}/${movie.tmdbId}`} target="_blank" rel="noreferrer">TMDB 条目 ↗</a>}{Number.isSafeInteger(movie.doubanId) && (movie.doubanId || 0) > 0 && <a href={`https://movie.douban.com/subject/${movie.doubanId}/`} target="_blank" rel="noreferrer">豆瓣条目 ↗</a>}</dd></div>}
              {watchedDate && <div><dt>观影日期</dt><dd>{watchedDate}</dd></div>}
            </dl>
          </header>

          <section className="detail-section" aria-labelledby="detail-overview-heading">
            <h2 id="detail-overview-heading">{movie.mediaType === "tv" ? "剧集简介" : "电影简介"}</h2>
            <p className="detail-overview">{movie.overview || "暂无简介。"}</p>
          </section>

          {magnet && <MagnetSection magnet={magnet} />}

          <section className="detail-section" aria-labelledby="detail-cast-heading">
            <div className="detail-section-heading"><h2 id="detail-cast-heading">主演</h2></div>
            {movie.cast.length ? <ul className="detail-cast-list">{movie.cast.map((actor, index) => {
              const content = <>
                <ActorPhoto src={actor.profileUrl} name={actor.name} />
                <span className="detail-actor-description">
                  <span className="detail-actor-name">{actor.name}</span>
                  {actor.character && <span className="detail-actor-role">饰 {actor.character}</span>}
                </span>
              </>;
              const hasPersonId = typeof actor.tmdbPersonId === "number" && Number.isSafeInteger(actor.tmdbPersonId) && actor.tmdbPersonId > 0;
              return <li key={`${actor.tmdbPersonId || actor.name}-${index}`}>
                {hasPersonId ? <Link className="detail-actor-item detail-actor-link" to={`/actors/${actor.tmdbPersonId}${movie.mediaType === "tv" ? "?mediaType=tv" : ""}`} state={nextNavigationState(location)} aria-label={`查看${actor.name}的参演作品`}>{content}</Link> : <span className="detail-actor-item">{content}</span>}
              </li>;
            })}</ul> : <p className="detail-muted">暂无主演资料。</p>}
          </section>
        </div>
      </div>
    </article>
  );
}

function MagnetSection({ magnet }: { magnet: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  const [feedback, setFeedback] = useState("");
  const [copying, setCopying] = useState(false);
  useEffect(() => { setFeedback(""); setCopying(false); }, [magnet]);

  async function copy() {
    if (copying) return;
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(magnet);
      setFeedback("磁力链接已复制。");
    } catch {
      const selection = window.getSelection();
      if (selection && link.current) {
        const range = document.createRange();
        range.selectNodeContents(link.current);
        selection.removeAllRanges();
        selection.addRange(range);
        setFeedback("已选中磁力链接，可手动复制。");
      } else setFeedback("请选中下方的磁力链接并复制。");
    } finally { setCopying(false); }
  }

  return (
    <section className="detail-section detail-magnet-section" aria-labelledby="detail-magnet-heading">
      <div className="detail-section-heading">
        <h2 id="detail-magnet-heading">磁力链接</h2>
        <button type="button" className="detail-copy-button" aria-label="复制磁力链接" disabled={copying} onClick={() => void copy()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></svg>
          {copying ? "正在复制…" : "复制链接"}
        </button>
      </div>
      <a ref={link} className="detail-magnet-link" href={magnet} aria-label="磁力链接">{magnet}</a>
      <p className="detail-copy-feedback" role="status" aria-live="polite">{feedback}</p>
    </section>
  );
}

function formatWatchedDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
