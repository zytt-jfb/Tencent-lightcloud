const SHARED_KEYS = ['year', 'months', 'cities', 'metric'] as const;

export function sharedV3Search(search: string): string {
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();
  for (const key of SHARED_KEYS) {
    const value = source.get(key);
    if (value) target.set(key, value);
  }
  const query = target.toString();
  return query ? `?${query}` : '';
}

export function navigateWithV3Context(path: string, search: string): string {
  const target = new URL(path, window.location.origin);
  const shared = new URLSearchParams(sharedV3Search(search).replace(/^\?/, ''));
  for (const [key, value] of shared) if (!target.searchParams.has(key)) target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
}

export function singleMonth(search: URLSearchParams): number | undefined {
  const raw = search.get('months') || search.get('month');
  if (!raw || raw.includes(',')) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : undefined;
}

export function cityIdsFromSearch(search: URLSearchParams): number[] {
  const raw = search.get('cities');
  if (!raw) return [];
  return [...new Set(raw.split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

