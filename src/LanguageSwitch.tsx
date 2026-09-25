import { useState } from 'react';
import { LOCALES, setLocale, t, useLocale, type Locale } from './i18n';

// F16-08: the same language choice on all three product arms. The app remounts
// on change (see main.tsx), so every screen re-renders in the new language.
export default function LanguageSwitch({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: Locale) {
    setBusy(true);
    setFailed(false);
    try {
      await setLocale(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className={`language-switch ${className}`.trim()}>
      <span>{t('Dil')}</span>
      <select value={locale} disabled={busy} onChange={(event) => void change(event.target.value as Locale)}>
        {LOCALES.map((item) => <option key={item.id} value={item.id} lang={item.id}>{item.label}</option>)}
      </select>
      {failed && <small role="status">{t('Dil paketi yüklenemedi. Lütfen tekrar deneyin.')}</small>}
    </label>
  );
}
