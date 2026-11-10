import { useEffect, useState } from "react";
import { FilmIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PosterVariant } from "@film-shelf/shared";
import { posterSrcSet } from "@film-shelf/shared/home-grid";

export function MoviePoster({ src, title, className, variants }: { src: string | null; title: string; className?: string; variants?: PosterVariant[] }) {
  const [failed, setFailed] = useState(false);
  const [variantFailed, setVariantFailed] = useState(false);
  useEffect(() => { setFailed(false); setVariantFailed(false); }, [src]);
  const srcSet = variantFailed ? undefined : posterSrcSet(variants);
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground", className)}>
      {src && !failed ? <img src={src} srcSet={srcSet} sizes={srcSet ? "96px" : undefined} alt={`${title}海报`} width={80} height={120} loading="lazy" decoding="async" className="size-full object-cover" onError={() => { if (srcSet) setVariantFailed(true); else setFailed(true); }} /> : <FilmIcon className="size-5 opacity-40" aria-label="暂无海报" />}
    </div>
  );
}
