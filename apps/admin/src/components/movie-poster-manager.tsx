import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Movie, MoviePosterList } from "@film-shelf/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoviePoster } from "@/components/movie-poster";
import { api, errorMessage } from "@/lib/api";

export function MoviePosterManager({ movie, onSaved }: { movie: Movie; onSaved: (movie: Movie) => void }) {
  const [gallery, setGallery] = useState<MoviePosterList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [urls, setUrls] = useState("");
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const pendingFocus = useRef<HTMLButtonElement | null>(null);
  const endpoint = `/api/movies/${movie.id}/posters`;
  useEffect(() => {
    if (busy || !pendingFocus.current) return;
    pendingFocus.current.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [busy]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    api<MoviePosterList>(endpoint, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setGallery(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, revision]);

  async function collect(manual: boolean) {
    if (lock.current || loading) return;
    const photoUrls = [...new Set(urls.trim().split(/\s+/).filter(Boolean))];
    if (manual && (!photoUrls.length || photoUrls.length > 40 || photoUrls.some((url) => !/^https:\/\/movie\.douban\.com\/photos\/photo\/[1-9]\d*\/$/.test(url)))) {
      setError("请输入 1–40 个豆瓣图片详情页链接，每行一个，例如 https://movie.douban.com/photos/photo/123456/。");
      return;
    }
    lock.current = true; setBusy(manual ? "import" : "sync"); setError(null); setFeedback("");
    try {
      const result = await api<MoviePosterList & { added: number; failed: number }>(manual ? endpoint : `${endpoint}/sync`, { method: "POST", body: JSON.stringify(manual ? { photoUrls } : {}) });
      setGallery(result);
      setFeedback(`已新增 ${result.added} 张海报${result.failed ? `，${result.failed} 张未能获取，可重试` : ""}。`);
      if (manual && !result.failed) setUrls("");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { lock.current = false; setBusy(null); }
  }

  async function choose(posterId: number, button: HTMLButtonElement) {
    if (lock.current || loading || gallery?.primaryPosterId === posterId) return;
    pendingFocus.current = button;
    lock.current = true; setBusy(String(posterId)); setError(null); setFeedback("");
    try {
      const result = await api<{ movie: Movie }>(`/api/movies/${movie.id}/poster`, { method: "PATCH", body: JSON.stringify({ posterId }) });
      setGallery((value) => value ? { ...value, primaryPosterId: posterId } : value);
      onSaved(result.movie); setFeedback("主封面已保存。");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { lock.current = false; setBusy(null); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void collect(true); }
  return <section className="grid gap-3" aria-busy={loading || !!busy}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">海报与主封面</h3><Button type="button" variant="outline" size="sm" disabled={loading || !!busy} onClick={() => void collect(false)}>{busy === "sync" ? "正在获取…" : "获取更多海报"}</Button></div>
    <p className="text-xs leading-5 text-muted-foreground">选择海报可保存为主封面，前台详情页可浏览所有已保存海报。</p>
    {loading ? <p className="text-muted-foreground">正在加载海报…</p> : gallery?.posters.length ? <ul role="list" className="grid grid-cols-3 gap-2 sm:grid-cols-4">{gallery.posters.map((poster, index) => <li key={poster.id}><button type="button" className="grid w-full gap-1 rounded-md border p-1 text-xs outline-offset-2 focus-visible:outline-2 disabled:cursor-wait" disabled={!!busy} aria-pressed={gallery.primaryPosterId === poster.id} aria-label={`将第 ${index + 1} 张海报设为主封面`} onClick={(event) => void choose(poster.id, event.currentTarget)}><MoviePoster src={poster.url} variants={poster.posterVariants} title={movie.title} className="aspect-[2/3] w-full" /><span>{busy === String(poster.id) ? "正在保存…" : gallery.primaryPosterId === poster.id ? "✓ 主封面" : "设为主封面"}</span></button></li>)}</ul> : gallery && <p className="text-muted-foreground">暂无已保存海报，请获取或导入海报。</p>}
    {error && <div className="grid gap-2"><p role="alert" className="text-xs leading-5 text-destructive">{error}</p>{!gallery && <Button type="button" size="sm" variant="outline" className="w-fit" disabled={loading || !!busy} onClick={() => setRevision((value) => value + 1)}>重新加载海报</Button>}</div>}
    <p role="status" className="text-xs leading-5 text-muted-foreground">{feedback}</p>
    {!!movie.doubanId && <form className="grid gap-2" onSubmit={submit}>
      <a className="w-fit text-xs underline underline-offset-4" href={`https://movie.douban.com/subject/${movie.doubanId}/photos?type=R`} target="_blank" rel="noreferrer">打开豆瓣海报相册 ↗</a>
      <Label htmlFor={`poster-urls-${movie.id}`}>批量导入豆瓣海报</Label>
      <p id={`poster-hint-${movie.id}`} className="text-xs leading-5 text-muted-foreground">自动获取受限时，可从相册打开图片详情页，粘贴其页面链接。每行一个，最多 40 个；仅保存属于本作品的海报。</p>
      <textarea id={`poster-urls-${movie.id}`} aria-describedby={`poster-hint-${movie.id}`} className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-offset-2 focus-visible:outline-2" value={urls} onChange={(event) => setUrls(event.target.value)} disabled={!!busy} placeholder="https://movie.douban.com/photos/photo/123456/" maxLength={12000} autoComplete="off" spellCheck={false} />
      <Button type="submit" size="sm" variant="outline" className="w-fit" disabled={loading || !!busy || !urls.trim()}>{busy === "import" ? "正在导入…" : "导入海报"}</Button>
    </form>}
  </section>;
}
