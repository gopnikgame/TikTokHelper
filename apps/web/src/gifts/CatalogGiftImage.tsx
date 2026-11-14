import { useState } from 'react';

export function CatalogGiftImage({ imageUrl }: { imageUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) return <span className="catalog-placeholder" aria-hidden="true">🎁</span>;
  return <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
