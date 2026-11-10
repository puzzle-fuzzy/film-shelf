import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { MediaType, Movie, MovieList, MovieStatus } from "@film-shelf/shared";
import { Navigate, Route, Routes, useSearchParams } from "react-router";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { DataTable } from "@/components/data-table";
import { AddMovieDialog } from "@/components/add-movie-dialog";
import { MovieDetailDialog } from "@/components/movie-detail-dialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { api, errorMessage } from "@/lib/api";

export default function App() {
  return <Routes><Route path="/movies" element={<MovieAdmin />} /><Route path="*" element={<Navigate to="/movies" replace />} /></Routes>;
}

function MovieAdmin() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const mediaType = params.get("mediaType") === "tv" ? "tv" : params.get("mediaType") === "movie" ? "movie" : "all";
  const parsedPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const parsedSize = Number(params.get("pageSize") || 10);
  const pageSize = [10, 20, 30, 40, 50].includes(parsedSize) ? parsedSize : 10;
  const [query, setQuery] = useState(q);
  const [data, setData] = useState<MovieList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ tmdb: boolean; douban: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Movie | null>(null);
  const [changingId, setChangingId] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => { setQuery(q); }, [q]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ providers: { tmdb: boolean; douban: boolean } }>("/api/health", { signal: controller.signal }).then((health) => { if (!controller.signal.aborted) setProviders(health.providers); }).catch(() => {});
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) search.set("q", q);
    if (mediaType !== "all") search.set("mediaType", mediaType);
    api<MovieList>(`/api/movies?${search}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (page > 1 && result.movies.length === 0) {
        const next = new URLSearchParams(params);
        next.set("page", String(Math.max(1, Math.ceil(result.total / pageSize))));
        setParams(next, { replace: true });
      } else setData(result);
    }).catch((error) => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [q, page, pageSize, mediaType, revision, setParams]);

  function changeMediaType(value: MediaType | "all") {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value === "all") next.delete("mediaType"); else next.set("mediaType", value);
    setLoading(true);
    setData(null);
    setParams(next);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    next.delete("page");
    if (query.trim()) next.set("q", query.trim()); else next.delete("q");
    setParams(next);
  }
  function changePage(nextPage: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(nextPage));
    setParams(next);
  }
  function changePageSize(size: number) {
    const next = new URLSearchParams(params);
    next.delete("page");
    next.set("pageSize", String(size));
    setParams(next);
  }
  async function changeStatus(movie: Movie, status: MovieStatus) {
    if (changingId !== null || movie.status === status) return;
    setChangingId(movie.id);
    try {
      const result = await api<{ movie: Movie }>(`/api/movies/${movie.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setDetail((current) => current?.id === movie.id ? result.movie : current);
      setRevision((value) => value + 1);
      toast.success(status === "watched" ? `《${movie.title}》已标记为已观影` : `《${movie.title}》已移回推荐`);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setChangingId(null); }
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 12)" } as CSSProperties}>
      <AppSidebar variant="inset" onAdd={() => setAddOpen(true)} />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <DataTable mediaType={mediaType} onMediaType={changeMediaType} movies={data?.movies || []} loading={loading} error={error} onRetry={() => setRevision((value) => value + 1)} changingId={changingId} total={data?.total || 0} page={page} pageSize={pageSize} onPage={changePage} onPageSize={changePageSize} query={query} onQuery={setQuery} onSearch={submitSearch} onClearSearch={() => { setQuery(""); const next = new URLSearchParams(params); next.delete("q"); next.delete("page"); setParams(next); }} onDetail={setDetail} onStatus={(movie, status) => void changeStatus(movie, status)} onAdd={() => setAddOpen(true)} />
              <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 text-[10px] leading-5 text-muted-foreground lg:px-6"><a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" aria-label="TMDB 影视资料来源"><img src="/tmdb.svg" alt="TMDB" width={64} height={8} loading="lazy" decoding="async" className="h-auto w-16" /></a><span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span></footer>
            </div>
          </div>
        </div>
      </SidebarInset>
      <AddMovieDialog open={addOpen} onOpenChange={setAddOpen} providers={providers} onAdded={(movie) => { setRevision((value) => value + 1); toast.success(`《${movie.title}》已加入推荐`); }} />
      <MovieDetailDialog movie={detail} onClose={() => setDetail(null)} onSaved={(movie) => { setDetail((current) => current?.id === movie.id ? movie : current); setRevision((value) => value + 1); toast.success("磁力链接已保存"); }} />
      <Toaster position="bottom-right" richColors closeButton />
    </SidebarProvider>
  );
}
