import { useEffect, useState } from "react";
import { FilmIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function MoviePoster({ src, title, className }: { src: string | null; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground", className)}>
      {src && !failed ? <img src={src} alt={`${title}海报`} width={80} height={120} loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(true)} /> : <FilmIcon className="size-5 opacity-40" aria-label="暂无海报" />}
    </div>
  );
}
