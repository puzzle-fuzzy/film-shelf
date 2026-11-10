import type { FormEvent } from "react";
import type { Movie, MovieStatus } from "@film-shelf/shared";
import { IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight, IconLoader, IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoviePoster } from "@/components/movie-poster";

interface Props {
  movies: Movie[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  changingId: number | null;
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  query: string;
  onQuery: (query: string) => void;
  onSearch: (event: FormEvent) => void;
  onClearSearch: () => void;
  onDetail: (movie: Movie) => void;
  onStatus: (movie: Movie, status: MovieStatus) => void;
  onAdd: () => void;
}

export function DataTable({ movies, loading, error, onRetry, changingId, total, page, pageSize, onPage, onPageSize, query, onQuery, onSearch, onClearSearch, onDetail, onStatus, onAdd }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex w-full flex-col justify-start gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
        <span className="text-sm font-medium">全部电影</span>
        <div className="flex items-center gap-2">
          <form onSubmit={onSearch} className="flex min-w-0 items-center gap-2">
            <label className="relative min-w-0 max-w-56 flex-1">
              <span className="sr-only">搜索片单</span>
              <IconSearch className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} maxLength={200} onChange={(event) => onQuery(event.target.value)} placeholder="搜索电影" className="h-8 w-36 pr-8 pl-8 sm:w-48" />
              {query && <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" onClick={onClearSearch} aria-label="清空搜索"><IconX className="size-3.5" /></button>}
            </label>
            <Button type="submit" variant="outline" size="sm" className="hidden sm:flex">搜索</Button>
          </form>
          <Button variant="outline" size="sm" onClick={onAdd}><IconPlus /><span>添加电影</span></Button>
        </div>
      </div>
      <div data-film-scrollbars="" className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead className="min-w-60">电影</TableHead>
                <TableHead className="min-w-28">上映日期</TableHead>
                <TableHead className="min-w-64">简介</TableHead>
                <TableHead className="min-w-44">主演</TableHead>
                <TableHead className="w-40 min-w-40">状态</TableHead>
                <TableHead className="min-w-28">磁力链接</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? <TableRow><TableCell colSpan={6} className="h-24 text-center"><div className="flex flex-wrap items-center justify-center gap-3 py-4"><span className="text-sm text-muted-foreground">{error}</span><Button variant="outline" size="sm" onClick={onRetry}>重新加载</Button></div></TableCell></TableRow> : loading ? Array.from({ length: 3 }, (_, index) => <TableRow key={index}><TableCell><div className="flex items-center gap-3"><Skeleton className="h-12 w-8" /><Skeleton className="h-4 w-28" /></div></TableCell>{Array.from({ length: 5 }, (_, cell) => <TableCell key={cell}><Skeleton className="h-4 w-20" /></TableCell>)}</TableRow>) : movies.length ? movies.map((movie) => (
                <TableRow key={movie.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <MoviePoster src={movie.posterUrl} title={movie.title} className="h-12 w-8" />
                      <div className="min-w-0"><Button variant="link" className="h-auto w-fit max-w-72 px-0 py-0 text-left whitespace-normal text-foreground" onClick={() => onDetail(movie)}>{movie.title}</Button>{movie.originalTitle && movie.originalTitle !== movie.title && <p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{movie.originalTitle}</p>}</div>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{movie.releaseDate || "暂无日期"}</TableCell>
                  <TableCell><p className="max-w-96 line-clamp-2 leading-6 whitespace-normal text-muted-foreground">{movie.overview || "暂无简介"}</p></TableCell>
                  <TableCell><p className="max-w-52 line-clamp-2 leading-6 whitespace-normal text-muted-foreground">{movie.cast.map((actor) => actor.name).join(" / ") || "暂无主演资料"}</p></TableCell>
                  <TableCell><div className="flex items-center gap-2"><Select value={movie.status} disabled={changingId !== null} onValueChange={(value) => onStatus(movie, value as MovieStatus)}><SelectTrigger size="sm" className="w-28" aria-label={`${movie.title}的状态`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recommended">推荐</SelectItem><SelectItem value="watched">已观影</SelectItem></SelectContent></Select>{changingId === movie.id && <IconLoader className="size-4 animate-spin text-muted-foreground" aria-label="正在保存" />}</div></TableCell>
                  <TableCell><Button variant="link" className="h-auto px-0 py-0 text-foreground" onClick={() => onDetail(movie)} aria-label={`编辑${movie.title}的磁力链接`}>{movie.magnetUrl ? "已填写" : "添加链接"}</Button></TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={6} className="h-24 text-center">{query ? "没有找到符合条件的电影。" : "暂无电影，点击「添加电影」开始录入。"}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex" role="status">共 {total} 部电影</div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex"><Label htmlFor="rows-per-page" className="text-sm font-medium">每页条数</Label><Select value={String(pageSize)} onValueChange={(value) => onPageSize(Number(value))}><SelectTrigger size="sm" className="w-20" id="rows-per-page"><SelectValue /></SelectTrigger><SelectContent side="top">{[10, 20, 30, 40, 50].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">第 {page} / {pages} 页</div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0"><Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" disabled={loading || page <= 1} onClick={() => onPage(1)}><span className="sr-only">第一页</span><IconChevronsLeft /></Button><Button variant="outline" className="size-8" size="icon" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}><span className="sr-only">上一页</span><IconChevronLeft /></Button><Button variant="outline" className="size-8" size="icon" disabled={loading || page >= pages} onClick={() => onPage(page + 1)}><span className="sr-only">下一页</span><IconChevronRight /></Button><Button variant="outline" className="hidden size-8 lg:flex" size="icon" disabled={loading || page >= pages} onClick={() => onPage(pages)}><span className="sr-only">最后一页</span><IconChevronsRight /></Button></div>
          </div>
        </div>
      </div>
    </div>
  );
}
