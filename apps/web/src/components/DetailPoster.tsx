import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MoviePosterList } from "@film-shelf/shared";
import { getMoviePosters } from "../lib/api";
import { posterSrcSet } from "@film-shelf/shared/home-grid";
import { Poster } from "./Poster";
import "./detail-poster.css";

export function DetailPoster({ src, title, movieId }: { src: string | null; title: string; movieId?: number | null }) {
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [gallery, setGallery] = useState<MoviePosterList | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!movieId) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    getMoviePosters(movieId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setGallery(value);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "海报图集暂时无法载入。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [movieId, revision]);

  return <><div className="detail-poster-view">
    <Poster src={src} title={title} priority onImageReady={setLoadedImage} />
    {loadedImage && <button
      ref={trigger}
      type="button"
      className="detail-poster-trigger"
      aria-label={`放大《${title}》海报`}
      aria-haspopup="dialog"
      onClick={() => gallery && gallery.posters.length > 1 ? setGalleryOpen(true) : setPreviewImage(loadedImage)}
    >
      <span className="detail-poster-hint" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" /></svg>
      </span>
    </button>}
    {previewImage && <PosterPreview
      source={previewImage}
      title={title}
      onDismiss={() => {
        setPreviewImage(null);
        trigger.current?.focus({ preventScroll: true });
      }}
    />}
    {galleryOpen && gallery && <PosterGallery gallery={gallery} title={title} onDismiss={() => setGalleryOpen(false)} />}
  </div>
    {movieId && <div className="detail-gallery-status">
      {loading && <p>正在加载海报图集…</p>}
      {error && <><p role="alert">{error}</p><button type="button" className="outline-button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>重新加载海报</button></>}
      {gallery && gallery.posters.length > 0 && <button type="button" className="outline-button" aria-haspopup="dialog" onClick={() => setGalleryOpen(true)}>浏览海报（{gallery.posters.length}）</button>}
      {!loading && !error && gallery?.posters.length === 0 && <p>暂无其它海报。</p>}
    </div>}
  </>;
}

function PosterGallery({ gallery, title, onDismiss }: { gallery: MoviePosterList; title: string; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(() => Math.max(0, gallery.posters.findIndex((poster) => poster.id === gallery.primaryPosterId)));
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const image = gallery.posters[index]!;
  useLayoutEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    return () => { if (modal.open) modal.close(); };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('.poster-gallery-thumbnails button[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);
  function choose(next: number) {
    const normalizedIndex = (next + gallery.posters.length) % gallery.posters.length;
    if (normalizedIndex === index) return;
    setIndex(normalizedIndex);
    setFailed(false); setLoading(true); setAttempt(0);
  }
  return <dialog ref={dialog} className="poster-gallery" aria-label={`《${title}》海报图集`} onClose={(event) => { if (!event.currentTarget.open) onDismiss(); }} onKeyDown={(event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || gallery.posters.length < 2) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); choose(index + (event.key === "ArrowLeft" ? -1 : 1)); }
  }}>
    <button type="button" autoFocus className="poster-preview-close" aria-label="关闭海报图集" onClick={() => dialog.current?.close()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    <div className="poster-gallery-stage">
      {!failed && <img key={`${image.id}-${attempt}`} src={image.url} alt={`《${title}》海报 ${index + 1}`} width={image.width || undefined} height={image.height || undefined} onLoad={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} />}
      {loading && <p className="poster-gallery-feedback">正在加载海报…</p>}
      {failed && <div className="poster-gallery-feedback"><p role="alert">这张海报未能加载。</p><button type="button" className="outline-button" onClick={() => { setFailed(false); setLoading(true); setAttempt((value) => value + 1); }}>重试图片</button></div>}
    </div>
    <div className="poster-gallery-controls"><button type="button" className="outline-button" disabled={gallery.posters.length < 2} onClick={() => choose(index - 1)} aria-label="上一张海报">← 上一张</button><span role="status" aria-atomic="true">{index + 1} / {gallery.posters.length}</span><button type="button" className="outline-button" disabled={gallery.posters.length < 2} onClick={() => choose(index + 1)} aria-label="下一张海报">下一张 →</button></div>
    <ul className="poster-gallery-thumbnails" role="list">{gallery.posters.map((poster, position) => <li key={poster.id}><button type="button" aria-label={`查看第 ${position + 1} 张海报`} aria-pressed={position === index} onClick={() => choose(position)}><img src={poster.url} srcSet={posterSrcSet(poster.posterVariants)} sizes="44px" alt="" loading="lazy" onError={(event) => { if (event.currentTarget.srcset) event.currentTarget.removeAttribute("srcset"); }} /></button></li>)}</ul>
  </dialog>;
}

function PosterPreview({ source, title, onDismiss }: { source: HTMLImageElement; title: string; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const poster = useRef<HTMLImageElement>(null);
  const white = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const animations = useRef<Animation[]>([]);
  const closing = useRef(false);

  useLayoutEffect(() => {
    const modal = dialog.current!;
    const image = poster.current!;
    const backdrop = white.current!;
    const from = source.getBoundingClientRect();
    modal.showModal();
    closeButton.current?.focus({ preventScroll: true });

    if (canAnimate(image)) {
      const to = image.getBoundingClientRect();
      animations.current = [
        image.animate([posterBox(from), posterBox(to)], { duration: 460, easing: "cubic-bezier(.2,.75,.24,1)" }),
        backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 460, easing: "ease-out" }),
      ];
    }

    return () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
      if (modal.open) modal.close();
    };
  }, [source]);

  function dismiss() {
    const modal = dialog.current;
    const image = poster.current;
    const backdrop = white.current;
    if (!modal?.open || !image || !backdrop || closing.current) return;
    closing.current = true;

    function finish() {
      if (!modal?.open) return;
      modal.close();
      onDismiss();
    }

    if (!canAnimate(image) || !source.isConnected) {
      finish();
      return;
    }

    const from = image.getBoundingClientRect();
    const to = source.getBoundingClientRect();
    const opacity = getComputedStyle(backdrop).opacity;
    animations.current.forEach((animation) => animation.cancel());
    const options: KeyframeAnimationOptions = { duration: 320, easing: "cubic-bezier(.4,0,.25,1)", fill: "forwards" };
    animations.current = [
      image.animate([posterBox(from), posterBox(to)], options),
      backdrop.animate([{ opacity }, { opacity: 0 }], options),
    ];
    void Promise.all(animations.current.map((animation) => animation.finished)).then(finish, () => {});
  }

  const ratio = source.naturalWidth / source.naturalHeight;
  return <dialog
    ref={dialog}
    className="poster-preview"
    aria-label={`《${title}》海报预览`}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
  >
    <div ref={white} className="poster-preview-white" aria-hidden="true" />
    <img
      ref={poster}
      className="poster-preview-image"
      src={source.currentSrc || source.src}
      alt={source.alt}
      width={source.naturalWidth}
      height={source.naturalHeight}
      style={{ "--poster-ratio": ratio } as CSSProperties}
      draggable={false}
    />
    <button ref={closeButton} type="button" className="poster-preview-close" aria-label="关闭海报预览" onClick={dismiss}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>
  </dialog>;
}

function canAnimate(element: HTMLElement) {
  return typeof element.animate === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function posterBox(rect: DOMRect): Keyframe {
  return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, translate: "none" };
}
