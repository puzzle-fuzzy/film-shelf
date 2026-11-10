import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Poster } from "./Poster";
import "./detail-poster.css";

export function DetailPoster({ src, title }: { src: string | null; title: string }) {
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return <div className="detail-poster-view">
    <Poster src={src} title={title} priority onImageReady={setLoadedImage} />
    {loadedImage && <button
      ref={trigger}
      type="button"
      className="detail-poster-trigger"
      aria-label={`放大《${title}》海报`}
      aria-haspopup="dialog"
      onClick={() => setPreviewImage(loadedImage)}
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
  </div>;
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
