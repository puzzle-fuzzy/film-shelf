export function MovieLoading() {
  return (
    <section className="detail-loading" role="status" aria-live="polite">
      <span className="detail-loading-poster" />
      <div><span /><span /><span /><p>正在载入影视详情…</p></div>
    </section>
  );
}
