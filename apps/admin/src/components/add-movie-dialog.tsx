import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Movie, SearchMovie } from "@film-shelf/shared";
import { InfoIcon, LoaderCircleIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoviePoster } from "@/components/movie-poster";
import { api, errorMessage } from "@/lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tmdbConfigured: boolean | null;
  onAdded: (movie: Movie) => void;
}

export function AddMovieDialog({ open, onOpenChange, tmdbConfigured, onAdded }: Props) {
  const [query, setQuery] = useState("");
  const [magnetUrl, setMagnetUrl] = useState("");
  const [results, setResults] = useState<SearchMovie[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      searchRequest.current?.abort();
      setQuery("");
      setMagnetUrl("");
      setResults(null);
      setSearching(false);
      setError(null);
    }
    return () => searchRequest.current?.abort();
  }, [open]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || searching || addingId !== null || tmdbConfigured === false) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const data = await api<{ results: SearchMovie[] }>(`/api/tmdb/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
      if (!controller.signal.aborted) setResults(data.results);
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function add(movie: SearchMovie) {
    if (addingId !== null) return;
    setAddingId(movie.tmdbId);
    setError(null);
    try {
      const data = await api<{ movie: Movie }>("/api/movies/import", { method: "POST", body: JSON.stringify({ tmdbId: movie.tmdbId, magnetUrl: magnetUrl.trim() || null }) });
      onAdded(data.movie);
      onOpenChange(false);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (addingId === null) onOpenChange(value); }}>
      <DialogContent data-film-scrollbars="vertical" className="max-h-[85dvh] gap-5 overflow-y-auto p-6 sm:max-w-2xl" showCloseButton={addingId === null} onEscapeKeyDown={(event) => { if (addingId !== null) event.preventDefault(); }} onPointerDownOutside={(event) => { if (addingId !== null) event.preventDefault(); }}>
        <DialogHeader className="gap-2 pr-4">
          <DialogTitle className="text-lg font-semibold">添加电影</DialogTitle>
          <DialogDescription className="text-xs leading-6">搜索电影名称，确认影片后自动获取资料并加入推荐片单。</DialogDescription>
        </DialogHeader>
        {tmdbConfigured === false && <Alert className="bg-muted/35"><InfoIcon /><AlertTitle>先连接电影资料库</AlertTitle><AlertDescription className="mt-1 text-xs leading-6">TMDB 尚未配置，请在服务端填写 TMDB Read Access Token 后重启服务。</AlertDescription></Alert>}
        <form onSubmit={search} className="flex gap-2">
          <label className="relative min-w-0 flex-1"><SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">电影名称</span><Input value={query} maxLength={200} onChange={(event) => { searchRequest.current?.abort(); setSearching(false); setQuery(event.target.value); setResults(null); setError(null); }} disabled={tmdbConfigured === false || addingId !== null} placeholder="输入中文或原文电影名" className="h-10 pl-9" autoComplete="off" /></label>
          <Button type="submit" className="h-10 px-4" disabled={!query.trim() || searching || addingId !== null || tmdbConfigured === false}>{searching ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}搜索</Button>
        </form>
        <div className="grid gap-2">
          <Label htmlFor="new-movie-magnet">磁力链接（可选）</Label>
          <Input id="new-movie-magnet" value={magnetUrl} onChange={(event) => setMagnetUrl(event.target.value)} disabled={addingId !== null} maxLength={16000} placeholder="magnet:?xt=urn:btih:…" autoComplete="off" spellCheck={false} />
        </div>
        {error && <Alert variant="destructive"><AlertTitle>未能完成操作</AlertTitle><AlertDescription className="mt-1 text-xs">{error}</AlertDescription></Alert>}
        <div aria-live="polite" aria-busy={searching || addingId !== null}>
          {searching ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />正在搜索电影…</div> : results === null ? <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center"><SearchIcon className="size-5 text-muted-foreground/50" /><p className="text-xs leading-6 text-muted-foreground">找到想看的电影，<br />把它留在你的片单里。</p></div> : results.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">没有找到相关电影，试试原文名称或其他关键词。</div> : <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">找到 {results.length} 个结果 · 请核对片名和上映日期</p>
            {results.map((movie) => <article key={movie.tmdbId} className="flex items-start gap-3 rounded-lg border p-3 sm:gap-4">
              <MoviePoster src={movie.posterUrl} title={movie.title} className="h-24 w-16 sm:h-28 sm:w-19" />
              <div className="min-w-0 flex-1"><h3 className="text-sm leading-6 font-medium">{movie.title}</h3>{movie.originalTitle !== movie.title && <p className="mt-0.5 truncate text-xs text-muted-foreground">{movie.originalTitle}</p>}<p className="mt-1 text-xs text-muted-foreground">{movie.releaseDate || "上映日期未知"}</p><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{movie.overview || "暂无电影简介"}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void add(movie)} disabled={addingId !== null}>{addingId === movie.tmdbId ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}{addingId === movie.tmdbId ? "正在获取资料…" : "加入推荐"}</Button></div>
            </article>)}
          </div>}
        </div>
        <p className="border-t pt-4 text-[11px] text-muted-foreground">电影资料由 TMDB 提供，中文内容可能因影片而有所不同。</p>
      </DialogContent>
    </Dialog>
  );
}
