import { useEffect, useState } from "react";

export function ActorPhoto({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const local = src && (/^\/api\/actors\/image\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(src) || /^\/api\/posters\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(src));
  return <span className="detail-actor-photo">
    {local && !failed ? <img src={src} alt={name} width={56} height={76} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span className="detail-actor-placeholder" role="img" aria-label={`${name}暂无照片`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
    </span>}
  </span>;
}
