import { useCallback, useEffect, useRef, useState } from 'react';
import type { GiftSoundMapping, RegionalGift, RegionalGiftPage, RegionalGiftRegion } from '@tiktok-helper/contracts';
import { REGIONAL_GIFT_REGIONS } from '@tiktok-helper/contracts/regional-gifts';

import { CatalogGiftImage } from './CatalogGiftImage.js';
import './regional-gift-catalog.css';

interface Props {
  workspacePath: string;
  mappings: ReadonlyMap<string, GiftSoundMapping>;
  onSelect(region: RegionalGiftRegion, gift: RegionalGift): void;
}

const regionNames: Record<RegionalGiftRegion, string> = {
  US: 'США', CA: 'Канада', AE: 'ОАЭ', DE: 'Германия', BY: 'Беларусь',
};
const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

function CatalogTime({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : <time dateTime={value}>{dateTime.format(date)}</time>;
}

export function RegionalGiftCatalog({ workspacePath, mappings, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<RegionalGiftRegion>(REGIONAL_GIFT_REGIONS[0]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ url: string; region: RegionalGiftRegion; data: RegionalGiftPage }>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const [refreshState, setRefreshState] = useState<{ region: RegionalGiftRegion; status: 'updating' | 'failed' }>();
  const refreshRequest = useRef<AbortController>(null);

  const regionPath = `${workspacePath}/regional-gifts/${region}`;
  const search = query.trim();
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set('q', search);
  const pageUrl = `${regionPath}?${params}`;
  const pageData = loaded?.url === pageUrl ? loaded.data : undefined;
  const regionData = loaded?.region === region ? loaded.data : undefined;
  const loadFailed = failedUrl === pageUrl;
  const loading = !pageData && !loadFailed;
  const updating = refreshState?.region === region && refreshState.status === 'updating';
  const refreshFailed = refreshState?.region === region && refreshState.status === 'failed';
  const nextRefreshAt = regionData?.canRefresh === false ? regionData.nextRefreshAt : null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(pageUrl, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Gift catalog request failed');
        const data = await response.json() as RegionalGiftPage;
        if (controller.signal.aborted) return;
        setLoaded({ url: pageUrl, region, data });
        setFailedUrl(undefined);
      } catch {
        if (!controller.signal.aborted) setFailedUrl(pageUrl);
      }
    }, search ? 200 : 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [open, pageUrl, region, revision, search]);

  const refresh = useCallback(async (force: boolean) => {
    if (refreshRequest.current) return;
    const controller = new AbortController();
    refreshRequest.current = controller;
    setRefreshState({ region, status: 'updating' });
    try {
      const response = await fetch(`${regionPath}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Gift catalog refresh failed');
      if (!controller.signal.aborted) setRefreshState(undefined);
    } catch {
      if (!controller.signal.aborted) setRefreshState({ region, status: 'failed' });
    } finally {
      if (refreshRequest.current === controller) refreshRequest.current = null;
      if (!controller.signal.aborted) setRevision((current) => current + 1);
    }
  }, [region, regionPath]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => void refresh(false), 120);
    return () => {
      window.clearTimeout(timeout);
      refreshRequest.current?.abort();
      refreshRequest.current = null;
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !nextRefreshAt) return;
    const remaining = Date.parse(nextRefreshAt) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timeout = window.setTimeout(() => setRevision((current) => current + 1),
      Math.min(Math.max(remaining + 1000, 1000), 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [nextRefreshAt, open]);

  const hasSavedList = Boolean(regionData?.updatedAt);
  const updateMessage = updating ? (hasSavedList ? 'Обновляем регион. Сохранённый список доступен.' : 'Загружаем подарки региона…')
    : regionData?.status === 'rate_limited' ? 'Источник временно ограничил обновления.'
    : refreshFailed || regionData?.status === 'unavailable' ? 'Не удалось обновить каталог региона.' : null;

  return <details className="regional-gift-catalog" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><strong>Подарки по регионам</strong><small aria-hidden="true">{open ? 'Свернуть' : 'Развернуть'}</small></summary>
    {open ? <div className="regional-gift-content">
      <div className="regional-gift-tools">
        <label>Регион подарков
          <select value={region} onChange={(event) => {
            const chosen = REGIONAL_GIFT_REGIONS.find((item) => item === event.target.value);
            if (chosen) { setRegion(chosen); setPage(1); }
          }}>
            {REGIONAL_GIFT_REGIONS.map((value) => <option key={value} value={value}>{regionNames[value]}</option>)}
          </select>
        </label>
        <label>Поиск подарка по названию или ID
          <input type="search" maxLength={160} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <button type="button" className="quiet" disabled={updating || regionData?.canRefresh === false}
          onClick={() => void refresh(true)}>Обновить регион</button>
      </div>
      <p className="regional-gift-hint">Состав подарков в конкретном эфире может отличаться.</p>
      <div className="regional-gift-status" role="status">
        {updateMessage ? <p>{updateMessage}{!updating && hasSavedList ? ' Можно выбрать подарок из сохранённого списка.' : ''}</p> : null}
        {loading && !updating ? <p>Загружаем список…</p> : null}
        {regionData?.updatedAt ? <p>Список от <CatalogTime value={regionData.updatedAt} /></p> : null}
        {!updating && nextRefreshAt ? <p>Обновить можно после <CatalogTime value={nextRefreshAt} /></p> : null}
        {loadFailed ? <p>Не удалось загрузить результаты поиска.</p> : null}
      </div>
      {loadFailed ? <button type="button" className="quiet" onClick={() => setRevision((current) => current + 1)}>Повторить поиск</button> : null}
      {regionData && (page > 1 || pageData?.hasMore || !pageData) ? <nav className="regional-gift-pagination" aria-label="Страницы подарков">
        <button type="button" className="quiet" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button>
        <span aria-live="polite">Страница {page}</span>
        <button type="button" className="quiet" disabled={!pageData?.hasMore} onClick={() => setPage(page + 1)}>Дальше</button>
      </nav> : null}
      <div aria-busy={loading}>
        {pageData?.gifts.length ? <ul className="catalog-list regional-gift-list" aria-label="Подарки выбранного региона">
          {pageData.gifts.map((gift) => {
            const mapping = mappings.get(gift.giftId);
            return <li key={gift.giftId}>
              <CatalogGiftImage key={gift.imageUrl} imageUrl={gift.imageUrl} />
              <div><strong><bdi>{gift.giftName}</bdi></strong><code>ID {gift.giftId}</code></div>
              <div className={mapping?.isEnabled ? 'mapping-state assigned' : 'mapping-state'}>
                <span>{mapping?.isEnabled ? 'Назначен звук' : 'Без звука'}</span>
                {mapping?.isEnabled ? <b>{mapping.soundDisplayName}</b> : null}
              </div>
              <button type="button" className="quiet" aria-label={`Настроить ${gift.giftName}, ID ${gift.giftId}`}
                onClick={() => onSelect(region, gift)}>Настроить</button>
            </li>;
          })}
        </ul> : null}
        {pageData?.gifts.length === 0 && !updating && (hasSavedList || pageData.status === 'empty') ? <p className="regional-gift-hint" role="status">
          {hasSavedList ? 'Подарки не найдены. Проверьте название или ID.' : 'Список для этого региона ещё не загружен.'}
        </p> : null}
      </div>
    </div> : null}
  </details>;
}
