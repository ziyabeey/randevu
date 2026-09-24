#!/usr/bin/env node
// Saat seçimi v2 — cookbook "Date extraction" yöntemi.
// Jev yalnız müşterinin ne söylediğini parça parça okur (gün, hafta, saat rakamı, dakika ifadesi,
// gün dilimi, istek türü); takvim/saat hesabını ve boş slotla eşleştirmeyi kod yapar.
// Eski yöntem (sunulan slotlar arasından tek Choice, "hazirlanmis") aynı çalıştırmada karşılaştırılır.
//
//   NODE_USE_ENV_PROXY=1 node saat-v2.mjs [--set=1|2|hepsi]

import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { TASKS } from './tasks.mjs';

const { values: args } = parseArgs({ options: { set: { type: 'string', default: 'hepsi' }, model: { type: 'string', default: 'jev-1.13.0' } } });
const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY?.trim() || 'proxy-injected', timeout: 30_000 });

const NOW = new Date(Date.UTC(2026, 9, 1, 10, 12)); // Perşembe 1 Ekim 2026 10:12 (veri setlerindeki "simdi")
const WEEKDAYS = ['pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar'];
const TR_MONTHS = { ocak: 0, şubat: 1, mart: 2, nisan: 3, mayıs: 4, haziran: 5, temmuz: 6, ağustos: 7, eylül: 8, ekim: 9, kasım: 10, aralık: 11 };
const none = (text) => ({ yok: text });

// ---------------------------------------------------------------- sorular (yalnız okuma, hesap yok)

const MSG = '`musteri_mesaji`';
const CONTEXT = ' `botun_onceki_mesaji` yalnız bağlamdır; müşterinin kendi söylediğini oku, sunulan saatlerden birini seçmeye çalışma.';
const QUESTIONS = {
  gun: { type: 'choice', instructions: `${MSG} hangi günü istiyor?${CONTEXT}`, criteria: {
    bugun: 'Bugün.', yarin: 'Yarın.', obur_gun: 'Öbür gün / yarından sonraki gün.',
    hafta_gunu: 'Bir haftanın gününü adıyla söylüyor (salı, cuma…); "haftaya pazartesi" da buna girer.',
    ayin_gunu: 'Ayın belirli bir gününü söylüyor ("ayın 7si", "16 Ekim").',
    hafta_sonu: 'Hafta sonu (gün adı vermeden).',
    ...none('Gün söylemiyor.'),
  } },
  hafta_gunu: { type: 'choice', instructions: `${MSG} bir haftanın gününü adıyla istiyorsa hangisi? Reddettiği günü değil, istediği günü seç.${CONTEXT}`, criteria: {
    pazartesi: null, sali: 'Salı', carsamba: 'Çarşamba', persembe: 'Perşembe', cuma: null, cumartesi: null, pazar: null,
    ...none('İstediği bir gün adı yok.'),
  } },
  hafta: { type: 'choice', instructions: `${MSG} hangi haftayı kastediyor?${CONTEXT}`, criteria: {
    bu_hafta: 'Bu hafta ya da en yakın gün ("önümüzdeki salı", "cuma").',
    gelecek_hafta: 'Gelecek takvim haftası ("haftaya", "gelecek hafta", "haftaya pazartesi").',
    iki_hafta_sonra: 'İki hafta sonra.',
    ...none('Hafta belirtmiyor.'),
  } },
  ayin_gunu: { type: 'choice', instructions: `${MSG} ayın belirli bir gününü söylüyorsa hangisi?${CONTEXT}`, criteria: {
    ...Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), null])),
    ...none('Ayın günü söylenmiyor.'),
  } },
  saat: { type: 'choice', instructions: `${MSG} içinde söylenen saat rakamı hangisi? Söylendiği gibi seç ("3" → 3, "15" → 15, "yedi" → 7). "Beşe çeyrek kala" ve "altıya çeyrek var" için söylenen saati seç (5, 6). "Yarım" tek başına saat 12:30 demektir → 12.${CONTEXT}`, criteria: {
    ...Object.fromEntries(Array.from({ length: 23 }, (_, i) => [String(i + 1), null])),
    ...none('Bir saat rakamı söylenmiyor ("öğleden sonra", "akşam" gibi yalnız gün dilimi dahil).'),
  } },
  dakika: { type: 'choice', instructions: `${MSG} saate hangi dakika ifadesini ekliyor?${CONTEXT}`, criteria: {
    tam: 'Tam saat ya da dakika belirtmeden saat ("3", "saat 5", "on biri").',
    bucuk: 'Buçuk / yarım / :30.',
    ceyrek_gece: 'Çeyrek geçe / :15.',
    ceyrek_kala: 'Çeyrek kala ya da çeyrek var (bir önceki saatin :45\'i).',
    yaklasik: 'Yaklaşık: "3 gibi", "3\'ü biraz geçe", "civarı".',
    diger: 'Başka belirli bir dakika (":10", "20 geçe").',
    ...none('Saat söylenmiyor.'),
  } },
  gun_dilimi: { type: 'choice', instructions: `${MSG} günün hangi dilimini söylüyor?${CONTEXT}`, criteria: {
    sabah: 'Sabah ya da öğleden önce.', ogle: 'Öğle / öğlen arası.', ogleden_sonra: 'Öğleden sonra / öğle yemeğinden sonra.', aksam: 'Akşam / işten sonra.',
    ...none('Gün dilimi söylenmiyor.'),
  } },
  istek: { type: 'choice', instructions: `${MSG} saat konusunda ne tür bir istek yapıyor?${CONTEXT}`, criteria: {
    belirli: 'Belirli bir saat ya da gün istiyor.',
    en_erken: 'En erken uygun olanı istiyor.',
    once: 'Belli bir saatten önce olsun istiyor ("4\'ten önce").',
    sonra: 'Belli bir saatten sonra olsun istiyor ("işten 6\'da çıkıyorum", "7\'den sonra").',
    herhangi: 'Belirtilen gün içinde hangisi uygunsa olur diyor.',
    hicbiri: 'Sunulanların hiçbirini istemiyor ya da hepsini reddediyor.',
  } },
  reddedilen: { type: 'choice', instructions: `${MSG} açıkça istemediği bir gün söylüyor mu, söylüyorsa hangisi?${CONTEXT}`, criteria: {
    bugun: 'Bugün olmaz.', yarin: 'Yarın olmaz.', ...Object.fromEntries(WEEKDAYS.map((d) => [d, null])),
    ...none('Reddedilen gün yok.'),
  } },
};

// ---------------------------------------------------------------- kod: çöz ve eşleştir

const DAY_MS = 86_400_000;
const dayStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const weekdayIndex = (d) => (d.getUTCDay() + 6) % 7; // 0 = pazartesi
const addDays = (d, n) => new Date(dayStart(d).getTime() + n * DAY_MS);
const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();

function parseSlot(text) {
  const m = text.match(/(\d{1,2})\s+(\p{L}+)\s+(\d{1,2}):(\d{2})/u);
  return new Date(Date.UTC(2026, TR_MONTHS[m[2].toLocaleLowerCase('tr-TR')], Number(m[1]), Number(m[3]), Number(m[4])));
}

function candidateDays(p) {
  const today = dayStart(NOW);
  const weekStart = addDays(today, -weekdayIndex(today));
  const days = [];
  if (p.gun === 'bugun') days.push(today);
  else if (p.gun === 'yarin') days.push(addDays(today, 1));
  else if (p.gun === 'obur_gun') days.push(addDays(today, 2));
  else if (p.gun === 'hafta_sonu') days.push(addDays(weekStart, 5), addDays(weekStart, 6));
  else if (p.gun === 'ayin_gunu' && p.ayin_gunu !== 'yok') {
    let d = new Date(Date.UTC(2026, NOW.getUTCMonth(), Number(p.ayin_gunu)));
    if (d < today) d = new Date(Date.UTC(2026, NOW.getUTCMonth() + 1, Number(p.ayin_gunu)));
    days.push(d);
  } else if (p.gun === 'hafta_gunu' && p.hafta_gunu !== 'yok') {
    const target = WEEKDAYS.indexOf(p.hafta_gunu);
    const offset = { gelecek_hafta: 7, iki_hafta_sonra: 14 }[p.hafta];
    if (offset) days.push(addDays(weekStart, offset + target));
    else { let d = addDays(weekStart, target); if (d < today) d = addDays(d, 7); days.push(d); }
  } else if (p.hafta === 'gelecek_hafta' || p.hafta === 'iki_hafta_sonra') {
    const start = addDays(weekStart, p.hafta === 'gelecek_hafta' ? 7 : 14);
    for (let i = 0; i < 7; i += 1) days.push(addDays(start, i));
  }
  return days;
}

function targetMinutes(p) {
  if (p.saat === 'yok') return null;
  let h = Number(p.saat);
  if (h <= 12) {
    if ((p.gun_dilimi === 'ogleden_sonra' || p.gun_dilimi === 'aksam') && h < 12) h += 12;
    else if (p.gun_dilimi !== 'sabah' && h >= 1 && h <= 8) h += 12; // salon saatlerinde 1–8 öğleden sonradır
  }
  const minute = { tam: 0, yaklasik: 0, bucuk: 30, ceyrek_gece: 15, ceyrek_kala: -15 }[p.dakika];
  if (minute === undefined) return p.dakika === 'diger' ? { exactUnknown: true, h } : { value: h * 60 };
  return { value: h * 60 + minute, approx: p.dakika === 'yaklasik' };
}

const WINDOWS = { sabah: [0, 12 * 60], ogle: [11 * 60 + 30, 14 * 60], ogleden_sonra: [12 * 60, 18 * 60], aksam: [17 * 60, 24 * 60] };

function resolve(p, slots) {
  if (p.istek === 'hicbiri') return 'hicbiri';
  let pool = slots;
  const days = candidateDays(p);
  if (days.length) pool = pool.filter((s) => days.some((d) => sameDay(d, s.at)));
  if (p.reddedilen !== 'yok') {
    const rejected = p.reddedilen === 'bugun' ? dayStart(NOW) : p.reddedilen === 'yarin' ? addDays(NOW, 1) : null;
    pool = pool.filter((s) => (rejected ? !sameDay(rejected, s.at) : WEEKDAYS[weekdayIndex(s.at)] !== p.reddedilen));
  }
  const minutes = (s) => s.at.getUTCHours() * 60 + s.at.getUTCMinutes();
  const t = targetMinutes(p);
  if (t?.exactUnknown) return 'hicbiri';
  if (t && p.istek === 'once') pool = pool.filter((s) => minutes(s) < t.value).sort((a, b) => minutes(b) - minutes(a));
  else if (t && p.istek === 'sonra') pool = pool.filter((s) => minutes(s) >= t.value).sort((a, b) => a.at - b.at);
  else if (t) {
    const exact = pool.filter((s) => minutes(s) === t.value);
    pool = exact.length || !t.approx ? exact : pool.filter((s) => minutes(s) > t.value && minutes(s) <= t.value + 30);
  } else if (p.gun_dilimi !== 'yok') {
    const [a, b] = WINDOWS[p.gun_dilimi];
    pool = pool.filter((s) => minutes(s) >= a && minutes(s) < b);
  }
  pool = [...pool].sort((a, b) => (p.istek === 'once' && t ? 0 : a.at - b.at));
  return pool[0]?.id ?? 'hicbiri';
}

// hangi parçaların kullanıldığına göre güven = en zayıf halka (cookbook: "lowest confidence among the parts")
function usedParts(p) {
  const used = ['gun', 'istek', 'reddedilen'];
  if (p.gun === 'hafta_gunu') used.push('hafta_gunu', 'hafta');
  if (p.gun === 'ayin_gunu') used.push('ayin_gunu');
  if (p.gun === 'yok') used.push('hafta');
  if (p.saat !== 'yok') used.push('saat', 'dakika');
  used.push('gun_dilimi');
  return used;
}

// ---------------------------------------------------------------- çalıştır

const sets = args.set === 'hepsi' ? ['1', '2'] : [args.set];
const rows = [];
for (const set of sets) {
  const items = TASKS.saat.items(set);
  await Promise.all(items.map(async (item) => {
    const slots = Object.entries(item.offered).map(([id, text]) => ({ id, text, at: parseSlot(text) }));
    const state = { simdi: item.now, botun_onceki_mesaji: `Şu saatler uygun: ${Object.values(item.offered).join(', ')}. Hangisini istersiniz?`, musteri_mesaji: item.message };
    const old = TASKS.saat.request(item, 'hazirlanmis');
    const [v2, v1] = await Promise.all([
      client.systemOne({ model: args.model, state, questions: QUESTIONS }),
      client.systemOne({ model: args.model, state: old.state, questions: { karar: old.question } }),
    ]);
    const parts = Object.fromEntries(Object.entries(v2.answers).map(([k, a]) => [k, a.choice]));
    const choice = resolve(parts, slots);
    const confidence = Math.min(...usedParts(parts).map((k) => v2.answers[k].confidence));
    rows.push({
      set, id: item.id, message: item.message, accept: item.accept, ambiguous: item.ambiguous, tags: item.tags,
      v2: { choice, confidence, parts, ok: item.accept.includes(choice), tokens: v2.usage.input_tokens },
      v1: { choice: v1.answers.karar.choice, confidence: v1.answers.karar.confidence, ok: item.accept.includes(v1.answers.karar.choice), tokens: v1.usage.input_tokens },
    });
  }));
}

// ---------------------------------------------------------------- rapor

const pct = (a, b) => (b ? `%${((a / b) * 100).toFixed(1)}` : '—');
const L = [`# Saat seçimi: tek Choice (v1) ve parça okuma + kod (v2) — ${new Date().toISOString()}`, ''];
L.push(`Model ${args.model}. v1 = sunulan slotlar arasından tek Choice ("hazirlanmis"); v2 = cookbook "Date extraction": 9 parça sorusu tek istekte, eşleştirme kodda, güven = kullanılan parçaların en düşüğü.`, '');
L.push('| Set | Yöntem | Net doğruluk | Güven ≥ 0.8 oranı | ≥ 0.8 iken doğruluk | Emin ama yanlış (≥ 0.8) | Token/mesaj |', '|---|---|---|---|---|---|---|');
for (const set of sets) for (const m of ['v1', 'v2']) {
  const clear = rows.filter((r) => r.set === set && !r.ambiguous);
  const conf = clear.filter((r) => r[m].confidence >= 0.8);
  L.push(`| ${set} | ${m} | ${pct(clear.filter((r) => r[m].ok).length, clear.length)} (${clear.filter((r) => r[m].ok).length}/${clear.length}) | ${pct(conf.length, clear.length)} | ${pct(conf.filter((r) => r[m].ok).length, conf.length)} | ${conf.filter((r) => !r[m].ok).length} | ${Math.round(rows.filter((r) => r.set === set).reduce((s, r) => s + r[m].tokens, 0) / rows.filter((r) => r.set === set).length)} |`);
}
L.push('', '## Mesaj bazında', '', '| Set | Mesaj | Beklenen | v1 | v2 | v2 parçaları |', '|---|---|---|---|---|---|');
for (const r of rows.sort((a, b) => a.set.localeCompare(b.set) || a.id.localeCompare(b.id))) {
  const mark = (x) => `${x.choice} ${x.confidence.toFixed(2)}${x.ok ? '' : ' ❌'}`;
  const p = r.v2.parts;
  L.push(`| ${r.set} | ${r.message}${r.ambiguous ? ' *(belirsiz)*' : ''} | ${r.accept.join('/')} | ${mark(r.v1)} | ${mark(r.v2)} | gün=${p.gun}${p.gun === 'hafta_gunu' ? `:${p.hafta_gunu}/${p.hafta}` : ''}${p.gun === 'ayin_gunu' ? `:${p.ayin_gunu}` : ''} saat=${p.saat} dk=${p.dakika} dilim=${p.gun_dilimi} istek=${p.istek}${p.reddedilen !== 'yok' ? ` red=${p.reddedilen}` : ''} |`);
}
const dir = new URL(`results/saat-v2-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('report.md', dir), L.join('\n') + '\n');
console.log(L.slice(0, 9).join('\n'));
console.log(`\nRapor: ${new URL('report.md', dir).pathname}`);
