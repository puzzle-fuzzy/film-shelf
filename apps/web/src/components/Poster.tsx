import type { PosterVariant } from "@film-shelf/shared";
import { localPosterPath, posterGridSizes, posterSrcSet } from "@film-shelf/shared/home-grid";
import { useEffect, useState } from "react";

export function Poster({ src, title, variants, priority = false, decorative = false, onImageReady }: {
  src: string | null;
  title: string;
  variants?: PosterVariant[];
  priority?: boolean;
  decorative?: boolean;
  onImageReady?: (image: HTMLImageElement | null) => void;
}) {
  const [failure, setFailure] = useState<"variants" | "original" | null>(null);
  useEffect(() => setFailure(null), [src]);
  const srcSet = failure ? undefined : posterSrcSet(variants);
  return (
    <span className="poster">
      {src && localPosterPath.test(src) && failure !== "original" ? (
        <img
          sizes={srcSet && posterGridSizes}
          srcSet={srcSet}
          src={src}
          alt={decorative ? "" : `${title}海报`}
          width={500}
          height={750}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          onLoad={onImageReady && ((event) => onImageReady(event.currentTarget))}
          onError={() => {
            setFailure(srcSet ? "variants" : "original");
            if (!srcSet) onImageReady?.(null);
          }}
        />
      ) : (
        <span className="poster-fallback" role={decorative ? undefined : "img"} aria-label={decorative ? undefined : `${title}暂无海报`} aria-hidden={decorative || undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M16 3v18M4 8h4M4 16h4M16 8h4M16 16h4" /></svg>
          <span>暂无海报</span>
        </span>
      )}
    </span>
  );
}
