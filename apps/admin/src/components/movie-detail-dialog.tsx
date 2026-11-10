import { useEffect, useState, type FormEvent } from "react";
import type { Movie } from "@film-shelf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoviePoster } from "@/components/movie-poster";
import { useIsMobile } from "@/hooks/use-mobile";
import { api, errorMessage } from "@/lib/api";
import { MoviePosterManager } from "@/components/movie-poster-manager";

export function MovieDetailDialog({ movie, onClose, onSaved }: { movie: Movie | null; onClose: () => void; onSaved: (movie: Movie, field: "poster" | "magnet") => void }) {
  const isMobile = useIsMobile();
  return (
    <Drawer open={movie !== null} onOpenChange={(open) => { if (!open) onClose(); }} direction={isMobile ? "bottom" : "right"}>
      <DrawerContent>
        {movie && <>
          <DrawerHeader className="gap-1">
            <DrawerTitle>{movie.title}</DrawerTitle>
            <DrawerDescription>{movie.originalTitle || movie.title}</DrawerDescription>
          </DrawerHeader>
          <div data-film-scrollbars="vertical" className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
            <div className="flex items-start gap-4">
              <MoviePoster src={movie.posterUrl} title={movie.title} className="h-36 w-24" />
              <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
                <Badge variant="outline" className="w-fit">{movie.mediaType === "tv" ? "电视剧" : "电影"}</Badge>
                <div className="grid gap-1"><span className="font-medium">{movie.mediaType === "tv" ? "首播日期" : "上映日期"}</span><span className="text-muted-foreground">{movie.releaseDate || "暂无资料"}</span></div>
                {movie.mediaType === "tv" && movie.episodeCount && <p className="text-muted-foreground">共 {movie.episodeCount} 集</p>}
                <div className="flex flex-wrap gap-3 text-xs">{Number.isSafeInteger(movie.tmdbId) && (movie.tmdbId || 0) > 0 && <a className="underline underline-offset-4" href={`https://www.themoviedb.org/${movie.mediaType === "tv" ? "tv" : "movie"}/${movie.tmdbId}`} target="_blank" rel="noreferrer">TMDB 条目</a>}{Number.isSafeInteger(movie.doubanId) && (movie.doubanId || 0) > 0 && <a className="underline underline-offset-4" href={`https://movie.douban.com/subject/${movie.doubanId}/`} target="_blank" rel="noreferrer">豆瓣条目</a>}</div>
                <Badge variant="outline" className="w-fit">{movie.status === "watched" ? "已观影" : "想看"}</Badge>
                {movie.watchedAt && <p className="text-xs leading-5 text-muted-foreground">{new Intl.DateTimeFormat("zh-CN").format(new Date(movie.watchedAt))} 标记已观影</p>}
              </div>
            </div>
            <Separator />
            <MoviePosterManager key={movie.id} movie={movie} onSaved={(saved) => onSaved(saved, "poster")} />
            <Separator />
            <MovieMagnetEditor key={movie.id} movie={movie} onSaved={(saved) => onSaved(saved, "magnet")} />
            <Separator />
            <section className="grid gap-2"><h3 className="font-medium">{movie.mediaType === "tv" ? "剧集简介" : "电影简介"}</h3><p className="leading-6 whitespace-pre-wrap text-muted-foreground">{movie.overview || "暂无简介。"}</p></section>
            <Separator />
            <section className="grid gap-3 pb-2"><h3 className="font-medium">主演</h3>{movie.cast.length === 0 ? <p className="text-muted-foreground">暂无主演资料。</p> : movie.cast.map((actor, index) => <div key={`${actor.name}-${index}`} className="flex items-center gap-3"><MoviePoster src={actor.profileUrl} title={actor.name} className="h-12 w-9 rounded" /><div className="min-w-0"><p className="font-medium">{actor.name}</p>{actor.character && <p className="mt-1 text-xs text-muted-foreground">饰 {actor.character}</p>}</div></div>)}</section>
          </div>
          <DrawerFooter><DrawerClose asChild><Button variant="outline">关闭</Button></DrawerClose></DrawerFooter>
        </>}
      </DrawerContent>
    </Drawer>
  );
}

function MovieMagnetEditor({ movie, onSaved }: { movie: Movie; onSaved: (movie: Movie) => void }) {
  const [value, setValue] = useState(movie.magnetUrl || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(movie.magnetUrl || ""); setError(null); }, [movie.magnetUrl]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ movie: Movie }>(`/api/movies/${movie.id}/magnet`, { method: "PATCH", body: JSON.stringify({ magnetUrl: value.trim() || null }) });
      onSaved(result.movie);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-2" onSubmit={(event) => void save(event)}>
      <Label htmlFor={`movie-magnet-${movie.id}`}>磁力链接</Label>
      <Input id={`movie-magnet-${movie.id}`} value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} disabled={saving} maxLength={16000} placeholder="magnet:?xt=urn:btih:…" autoComplete="off" spellCheck={false} />
      <p className="text-xs text-muted-foreground">留空后保存可清除链接。</p>
      {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
      <Button type="submit" variant="outline" size="sm" className="w-fit" disabled={saving || value.trim() === (movie.magnetUrl || "")}>{saving ? "正在保存…" : "保存磁力链接"}</Button>
    </form>
  );
}
