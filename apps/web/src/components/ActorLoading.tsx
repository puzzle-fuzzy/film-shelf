export function ActorWorksSkeleton() {
  return <div className="movie-grid" aria-label="正在载入参演作品">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className="card-skeleton" aria-hidden="true"><span /><i /><i /></div>)}
  </div>;
}

export function ActorLoading() {
  return <section className="actor-loading" aria-busy="true" aria-label="正在载入参演作品">
    <span className="actor-loading-back" aria-hidden="true" />
    <div className="page-heading actor-loading-heading">
      <div className="actor-loading-identity">
        <span className="actor-loading-photo" aria-hidden="true" />
        <h1>参演作品</h1>
      </div>
      <span className="movie-count" role="status">载入中…</span>
    </div>
    <div className="actor-loading-filter" aria-hidden="true" />
    <ActorWorksSkeleton />
  </section>;
}
