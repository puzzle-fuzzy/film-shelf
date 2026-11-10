import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MediaType, MetadataSearchResult, MetadataSource, Movie } from "@film-shelf/shared";
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
  providers: { tmdb: boolean; douban: boolean } | null;
  onAdded: (movie: Movie) => void;
}

const sourceName = { tmdb: "TMDB", douban: "豆瓣" };
const candidateKey = (movie: MetadataSearchResult) => `${movie.provider}:${movie.mediaType}:${movie.externalId}`;

export function AddMovieDialog({ open, onOpenChange, providers, onAdded }: Props) {
  const [provider, setProvider] = useState<MetadataSource>("tmdb");
  const [mediaType, setMediaType] = useState<MediaType>("movie");
  const [query, setQuery] = useState("");
  const [magnetUrl, setMagnetUrl] = useState("");
  const [results, setResults] = useState<MetadataSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const importPending = useRef(false);
  const session = useRef(0);
  const sourceTouched = useRef(false);
  const unavailable = providers?.[provider] === false;

  function clearSearch() {
    searchRequest.current?.abort();
    searchRequest.current = null;
    setResults(null);
    setSearching(false);
    setError(null);
  }

  useEffect(() => {
    session.current += 1;
    clearSearch();
    if (!open) {
      setQuery("");
      setMagnetUrl("");
      setMediaType("movie");
      sourceTouched.current = false;
    } else if (!sourceTouched.current) setProvider(providers?.tmdb === false && providers.douban ? "douban" : "tmdb");
    return () => searchRequest.current?.abort();
  }, [open]);

  useEffect(() => {
    if (open && !sourceTouched.current && !importPending.current && providers?.tmdb === false && providers.douban) {
      clearSearch();
      setProvider("douban");
    }
  }, [open, providers]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || searchRequest.current !== null || importPending.current || unavailable) return;
    clearSearch();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    const params = new URLSearchParams({ provider, mediaType, q: query.trim() });
    try {
      const data = await api<{ results: MetadataSearchResult[] }>(`/api/metadata/search?${params}`, { signal: controller.signal });
      if (!controller.signal.aborted && searchRequest.current === controller) setResults(data.results.filter((movie) => movie.provider === provider && movie.mediaType === mediaType));
    } catch (error) {
      if (!controller.signal.aborted && searchRequest.current === controller) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted && searchRequest.current === controller) { setSearching(false); searchRequest.current = null; }
    }
  }

  async function add(movie: MetadataSearchResult) {
    if (importPending.current || movie.provider !== provider || movie.mediaType !== mediaType) return;
    importPending.current = true;
    const currentSession = session.current;
    setAddingKey(candidateKey(movie));
    setError(null);
    try {
      const data = await api<{ movie: Movie }>("/api/movies/import", { method: "POST", body: JSON.stringify({ provider: movie.provider, mediaType: movie.mediaType, externalId: movie.externalId, magnetUrl: magnetUrl.trim() || null }) });
      onAdded(data.movie);
      if (session.current === currentSession) onOpenChange(false);
    } catch (error) {
      if (session.current === currentSession) setError(errorMessage(error));
    } finally {
      importPending.current = false;
      setAddingKey(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!importPending.current) onOpenChange(value); }}>
      <DialogContent data-film-scrollbars="vertical" className="max-h-[85dvh] gap-5 overflow-y-auto p-6 sm:max-w-2xl" showCloseButton={addingKey === null} onEscapeKeyDown={(event) => { if (importPending.current) event.preventDefault(); }} onPointerDownOutside={(event) => { if (importPending.current) event.preventDefault(); }}>
        <DialogHeader className="gap-2 pr-4"><DialogTitle className="text-lg font-semibold">添加影视</DialogTitle><DialogDescription className="text-xs leading-6">搜索名称，核对年份、国家和季别后加入想看片单。按所选资料源条目收录。</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <fieldset disabled={addingKey !== null} className="min-w-0"><legend className="mb-1 text-xs font-medium">资料来源</legend><div className="flex gap-4">{(["tmdb", "douban"] as const).map((value) => <label key={value} className="flex min-h-12 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="metadata-provider" value={value} checked={provider === value} onChange={() => { clearSearch(); sourceTouched.current = true; setProvider(value); }} />{sourceName[value]}</label>)}</div></fieldset>
          <fieldset disabled={addingKey !== null} className="min-w-0"><legend className="mb-1 text-xs font-medium">作品类型</legend><div className="flex gap-4">{(["movie", "tv"] as const).map((value) => <label key={value} className="flex min-h-12 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="metadata-type" value={value} checked={mediaType === value} onChange={() => { clearSearch(); setMediaType(value); }} />{value === "tv" ? "电视剧" : "电影"}</label>)}</div></fieldset>
        </div>
        {unavailable && <Alert className="bg-muted/35"><InfoIcon /><AlertTitle>{sourceName[provider]} 暂不可用</AlertTitle><AlertDescription className="mt-1 text-xs leading-6">请选择其他资料来源，或联系管理员连接此资料库。</AlertDescription></Alert>}
        <search><form action="/api/metadata/search" method="get" onSubmit={search} className="flex gap-2"><input type="hidden" name="provider" value={provider} /><input type="hidden" name="mediaType" value={mediaType} /><div className="min-w-0 flex-1"><Label htmlFor="metadata-query" className="mb-2">影视名称</Label><div className="relative"><SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="metadata-query" name="q" type="search" required value={query} maxLength={200} onChange={(event) => { clearSearch(); setQuery(event.target.value); }} disabled={unavailable || addingKey !== null} placeholder="输入中文或原文名称" className="h-12 pl-9 text-base" autoComplete="off" autoCapitalize="none" spellCheck={false} /></div></div><Button type="submit" className="mt-auto h-12 px-4" disabled={searching || addingKey !== null || unavailable}>{searching ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}搜索</Button></form></search>
        <div className="grid gap-2"><Label htmlFor="new-movie-magnet">磁力链接（可选）</Label><Input id="new-movie-magnet" name="magnetUrl" value={magnetUrl} onChange={(event) => setMagnetUrl(event.target.value)} disabled={addingKey !== null} maxLength={16000} placeholder="magnet:?xt=urn:btih:…" autoComplete="off" autoCapitalize="none" spellCheck={false} /></div>
        {error && <Alert variant="destructive" role="alert"><AlertTitle>未能完成操作</AlertTitle><AlertDescription className="mt-1 text-xs">{error}</AlertDescription></Alert>}
        <div aria-live="polite" aria-busy={searching || addingKey !== null}>
          {searching ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />正在搜索…</div> : results === null ? <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center"><SearchIcon className="size-5 text-muted-foreground/50" /><p className="text-xs leading-6 text-muted-foreground">找到想看的作品，<br />把它留在你的片单里。</p></div> : results.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">没有找到相关作品，试试原文名称或其他关键词。</div> : <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">找到 {results.length} 个结果 · 请核对年份、国家和季别</p>
            {results.map((movie) => <article key={candidateKey(movie)} className="flex items-start gap-3 rounded-lg border p-3 sm:gap-4"><MoviePoster src={movie.posterUrl} title={movie.title} className="h-24 w-16 sm:h-28 sm:w-19" /><div className="min-w-0 flex-1"><h3 className="text-sm leading-6 font-medium">{movie.title}</h3>{movie.originalTitle !== movie.title && <p className="mt-0.5 truncate text-xs text-muted-foreground">{movie.originalTitle}</p>}<p className="mt-1 text-xs text-muted-foreground">{[sourceName[movie.provider], movie.mediaType === "tv" ? "电视剧" : "电影", movie.year || movie.releaseDate?.slice(0, 4) || "年份未知", ...(movie.countries || [])].join(" · ")}</p><p className="mt-1 text-xs text-muted-foreground">{movie.mediaType === "tv" ? "首播" : "上映"}：{movie.releaseDate || "日期未知"}</p><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{movie.overview || "暂无简介"}</p><Button type="button" className="mt-3" size="sm" variant="outline" onClick={() => void add(movie)} disabled={addingKey !== null}>{addingKey === candidateKey(movie) ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}{addingKey === candidateKey(movie) ? "正在获取资料…" : "加入想看"}</Button></div></article>)}
          </div>}
        </div>
        <p className="border-t pt-4 text-[11px] text-muted-foreground">当前资料来源：{sourceName[provider]}。不同来源或季别可分别收录，请先核对条目。</p>
      </DialogContent>
    </Dialog>
  );
}
