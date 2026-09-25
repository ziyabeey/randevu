import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

function sourceFiles(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

const I18N_IMPORT = /from '(?:\.\.?\/)+i18n'/;
const translatedFiles = sourceFiles('src').filter((file) => !/\/i18n(-en)?\.ts$/.test(file) && I18N_IMPORT.test(read(file)));

function unescape(value) {
  return value.replace(/\\(['\\])/g, '$1');
}

function literalKeys(source) {
  return [...source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)].map((match) => unescape(match[1]));
}

function block(source, name) {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `${name} is missing`);
  const open = source.slice(start).search(/[[{]/);
  let depth = 0;
  for (let index = start + open; index < source.length; index += 1) {
    if ('[{'.includes(source[index])) depth += 1;
    if (']}'.includes(source[index])) depth -= 1;
    if (depth === 0) return source.slice(start + open, index + 1);
  }
  throw new Error(`${name} is not closed`);
}

const mapValues = (text) => [...text.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)].map((match) => unescape(match[1]));
const labels = (text) => [...text.matchAll(/label: '((?:[^'\\]|\\.)*)'/g)].map((match) => unescape(match[1]));
const strings = (text) => [...text.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => unescape(match[1]));

// Values kept as Turkish source text in module-level maps and translated where
// they are rendered (a module-level t() would freeze the language at import).
function dynamicKeys() {
  const kolay = read('src/kolayapp/KolayAppSurface.tsx');
  return [
    ...labels(block(read('src/WorkspaceShell.tsx'), 'NAV_ITEMS')),
    ...labels(block(read('src/kolayapp/model.ts'), 'KOLAY_APP_TABS')),
    ...[...kolay.matchAll(/(?:title|description)="([^"]+)"/g)].map((match) => match[1]),
    ...mapValues(block(read('src/AccountMenu.tsx'), 'PERMISSION_LABELS')),
    ...mapValues(block(read('src/PublicNotificationStatus.tsx'), 'statusText')),
    ...mapValues(block(read('src/ManageFeedback.tsx'), 'STATUS_TEXT')),
    ...mapValues(block(read('src/FeedbackPage.tsx'), 'STATUS_LABEL')),
    ...mapValues(block(read('src/StaffCommissionPanel.tsx'), 'KIND_LABEL')),
    ...mapValues(block(read('src/StaffCommissionPanel.tsx'), 'LINE_LABEL')),
    ...mapValues(block(read('src/BookingPage.tsx'), 'statusText')),
    ...labels(block(read('src/TeamPage.tsx'), 'PERMISSIONS')),
    ...strings(block(read('src/OnboardingPage.tsx'), 'weekdayLabels')),
    ...strings(block(read('src/AvailabilityPage.tsx'), 'weekdays')),
    ...strings(block(read('src/PublicSalonPage.tsx'), 'dayLabels')),
    ...mapValues(block(read('src/onboardingLocale.ts'), 'onboardingCopy')),
    'Randevu görünmüyor',
    'Randevular hazır olduğunda burada görünecek.',
  ];
}

function catalog() {
  const source = read('src/i18n-en.ts');
  const entries = [...source.matchAll(/^ {2}'((?:[^'\\]|\\.)*)': '((?:[^'\\]|\\.)*)',$/gm)];
  return new Map(entries.map((match) => [unescape(match[1]), unescape(match[2])]));
}

// Brand names are the same in every language and are not catalogued.
const SAME_IN_ALL_LANGUAGES = new Set(['KolayApp']);
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('F16-08 every translated string has an English entry with the same placeholders', () => {
  const english = catalog();
  assert.ok(english.size > 900, `English catalog is unexpectedly small (${english.size})`);
  const keys = new Set([...translatedFiles.flatMap((file) => literalKeys(read(file))), ...dynamicKeys()]);
  const missing = [...keys].filter((key) => !english.has(key) && !SAME_IN_ALL_LANGUAGES.has(key));
  assert.deepEqual(missing, [], 'untranslated keys');
  for (const [key, value] of english) {
    assert.ok(value.trim(), `empty translation for ${key}`);
    assert.deepEqual(placeholders(value), placeholders(key), `placeholder mismatch for ${key}`);
  }
});

test('F16-08 all three arms are wired to the language boundary', () => {
  const files = new Set(translatedFiles);
  for (const file of [
    // Customer panel
    'src/PublicSalonPage.tsx', 'src/PublicBookingPage.tsx', 'src/PublicMultiServiceSelection.tsx',
    'src/ManageAppointmentPage.tsx', 'src/ManageFeedback.tsx', 'src/PublicPromo.tsx', 'src/PublicReviews.tsx',
    // Randevu panel
    'src/WorkspaceShell.tsx', 'src/CalendarPage.tsx', 'src/BookingPage.tsx', 'src/CustomersPage.tsx',
    'src/ServicesPage.tsx', 'src/TeamPage.tsx', 'src/FinancialReportsPage.tsx', 'src/OnboardingPage.tsx',
    // SalonApp
    'src/kolayapp/KolayAppShell.tsx', 'src/kolayapp/KolayBottomNav.tsx', 'src/kolayapp/KolayAppSurface.tsx',
    'src/kolayapp/TicketCashierPage.tsx',
  ]) assert.ok(files.has(file), `${file} does not use the language boundary`);

  // Dates and amounts follow the active language; the remaining tr-TR calls
  // only validate a time zone or currency code or build Turkish initials.
  for (const file of sourceFiles('src')) {
    for (const line of read(file).split('\n')) {
      if (!/Intl\.(DateTimeFormat|NumberFormat)\('tr-TR'|toLocaleString\('tr-TR'\)/.test(line)) continue;
      assert.match(line, /\{ timeZone: value \}\)|\.format\(0\)/, `${file} formats display text in Turkish only: ${line.trim()}`);
    }
  }
  assert.match(read('src/onboardingLocale.ts'), /PLAN_INACTIVE: '/);
  assert.match(read('src/api.ts'), /super\(t\(message\)\)/);
});

test('F16-08 the English catalog is lazy, remembered and falls back to Turkish', () => {
  const i18n = read('src/i18n.ts');
  const main = read('src/main.tsx');
  assert.match(i18n, /await import\('\.\/i18n-en'\)/);
  for (const file of sourceFiles('src')) {
    assert.doesNotMatch(read(file), /from '(?:\.\.?\/)+i18n-en'/, `${file} imports the English catalog statically`);
  }
  assert.match(i18n, /const STORAGE_KEY = 'yzt_locale'/);
  assert.match(i18n, /requestedLocale\(\) \?\? storedLocale\(\) \?\? 'tr'/);
  assert.match(i18n, /catalog\?\.\[text\] \?\? text/);
  assert.match(i18n, /document\.documentElement\.lang = next/);
  assert.match(main, /void initLocale\(\)\.finally\(/);
  assert.match(main, /<AppRouter key=\{locale\} \/>/);
  assert.match(read('src/PublicSalonPage.tsx'), /<LanguageSwitch/);
  assert.match(read('src/ManageAppointmentPage.tsx'), /<LanguageSwitch/);
  assert.match(read('src/AccountMenu.tsx'), /<LanguageSwitch \/>/);
});

test('F16-08 account menu reads real account and plan data on both operator arms', () => {
  const menu = read('src/AccountMenu.tsx');
  const shell = read('src/WorkspaceShell.tsx');
  const kolay = read('src/kolayapp/KolayAppSurface.tsx');
  const worker = read('worker/f16-account-http.ts');
  const app = read('worker/app.ts');
  const auth = read('worker/auth.ts');
  const migration = read('supabase/migrations/20260924220000_f16_account_plan.sql');
  assert.match(menu, /api<\{ account: AccountSummary \}>\('\/api\/account'\)/);
  assert.match(menu, /result\.account\.businessId !== businessId/);
  assert.match(menu, /onChangePassword/);
  assert.match(menu, /onLogout/);
  assert.match(shell, /<AccountMenu/);
  assert.match(kolay, /variant="panel"/);
  assert.match(worker, /account\.get\('\/account'/);
  assert.match(worker, /p_business_id: access\.membership\.business_id/);
  assert.match(app, /app\.route\('\/api', f16Account\)/);
  assert.match(auth, /plan:businesses!memberships_business_id_fkey\(plan_access\)/);
  assert.match(auth, /code: 'PLAN_READ_ONLY'/);
  assert.match(migration, /grant execute on function public\.get_account_summary\(uuid\) to authenticated;/);
  assert.match(migration, /case when not f\.has_plan_access then 'PLAN_INACTIVE' end/);
  assert.doesNotMatch(migration, /stripe|iyzico|charge_subscription/i);
});

test('F16-08 KolayApp actions are real routes or explicitly disabled', () => {
  const kolay = read('src/kolayapp/KolayAppSurface.tsx');
  const routes = read('src/workspace-route.ts');
  const hrefs = [...kolay.matchAll(/ActionLink href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length >= 20, `expected the full action list, found ${hrefs.length}`);
  for (const href of hrefs) {
    const pathname = href.split('?')[0];
    assert.ok(routes.includes(`'${pathname}':`), `${href} is not a workspace route`);
  }
  const disabled = [...kolay.matchAll(/<DisabledAction title="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(disabled, ['Destek']);
  assert.match(kolay, /className="kolay-action-disabled" aria-disabled="true"/);
  assert.match(kolay, /ActionLink href="\/app\/mobile\/tickets\?newPackageSale=1" title="Yeni paket satışı"/);
  const cashier = read('src/kolayapp/TicketCashierPage.tsx');
  assert.match(cashier, /initialParams\.get\('newPackageSale'\) === '1'/);
  assert.match(cashier, /'\/api\/tickets\/package-sales'/);
});
