export type KolayAppTab = 'appointments' | 'tickets' | 'new' | 'customers' | 'more';

export type KolayAppTabDefinition = Readonly<{
  id: KolayAppTab;
  label: string;
}>;

export const KOLAY_APP_TABS = [
  { id: 'appointments', label: 'Randevular' },
  { id: 'tickets', label: 'Adisyonlar' },
  { id: 'new', label: 'Yeni' },
  { id: 'customers', label: 'Müşteriler' },
  { id: 'more', label: 'Diğer' },
] as const satisfies readonly KolayAppTabDefinition[];

export function isKolayAppTab(value: unknown): value is KolayAppTab {
  return typeof value === 'string' && KOLAY_APP_TABS.some((tab) => tab.id === value);
}

export function adjacentKolayAppTab(current: KolayAppTab, direction: -1 | 1): KolayAppTab {
  const index = KOLAY_APP_TABS.findIndex((tab) => tab.id === current);
  const nextIndex = (index + direction + KOLAY_APP_TABS.length) % KOLAY_APP_TABS.length;
  const next = KOLAY_APP_TABS[nextIndex];
  return next?.id ?? current;
}

export function kolayAppTabLabel(tabId: KolayAppTab): string {
  return KOLAY_APP_TABS.find((tab) => tab.id === tabId)?.label ?? 'KolayApp';
}
