#!/usr/bin/env node
// Rakiplerin pazarlama metnini Jev ile atomik sorulara ayırır (cookbook: fan-out + composite scoring).
// Her rakip = 1 istek; tüm sorular aynı state üzerinde paralel değerlendirilir. Ağırlıklar kodda.
//
//   NODE_USE_ENV_PROXY=1 node rakip/analyze.mjs [--mock] [--yalniz-bizim]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { TypeSafeClient } from '@typesafe-ai/sdk';

const { values: args } = parseArgs({ options: {
  mock: { type: 'boolean', default: false },
  'yalniz-bizim': { type: 'boolean', default: false },
  model: { type: 'string', default: 'jev-1.13.0' },
} });
const here = new URL('.', import.meta.url);
const client = args.mock
  ? new TypeSafeClient({ apiKey: 'mock', fetch: mockFetch, retry: { maxRetries: 0 } })
  : new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY?.trim() || 'proxy-injected', timeout: 30_000 });

// ---------------------------------------------------------------- sorular

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const score = (instructions, criteria) => ({ type: 'score', instructions, criteria });
const noul = (instructions, yes, no) => ({ type: 'noul', instructions, criteria: { true: yes, false: no } });

const HERO = '`ana_sayfa.h1` ve hemen altındaki `ana_sayfa.hero_alt`';
const SITE = '`ana_sayfa` ve `sayfalar` içindeki başlıklar, alt metinler, CTA metinleri ve fiyat satırları birlikte okunduğunda';
// Evet/hayır sorularında "tüm başlıklar" demek Jev'e "hepsi mi" diye sorulmuş gibi okunur; kapsam "en az biri".
const ANY = '`ana_sayfa` ya da `sayfalar` içindeki metinlerden (başlık, alt metin, CTA, fiyat satırı) en az biri';
// Pazarlama sloganları kısa ve imalıdır; Jev kelimesi kelimesine okuduğu için (jaggedness #1) nouller anlamı sorar.
const MEANING = ' Sloganlar kısa ve imalı olabilir; belirli kelimelerin geçip geçmediğine değil, söylenen anlama bak.';

export const QUESTIONS = {
  // Açılış cümlesi = yalnız H1; alt metin çoğu zaman fayda anlattığı için ayrı tutulur.
  acilis_tipi: choice('`ana_sayfa.h1` başlığı tek başına okunduğunda ne tür bir cümle?', {
    fayda_vaadi: 'İşletmenin elde edeceği sonucu vaat ediyor (zaman, gelir, düzen, kolaylık).',
    aci_noktasi: 'İşletmenin yaşadığı bir sorunu ya da sıkıntıyı dile getiriyor.',
    sosyal_kanit: 'Kaç işletmenin kullandığını, puanları ya da müşteri sözlerini öne koyuyor.',
    fiyat_teklif: 'Fiyatı, ücretsiz kullanımı ya da bir kampanyayı öne koyuyor.',
    ozellik_listesi: 'Ürünün özelliklerini sıralıyor.',
    kategori_tanimi: 'Ürünün ne olduğunu tanımlıyor ("… için randevu programı / yönetim çözümü / tek platform").',
    ustunluk_iddiasi: 'Rakiplerden üstün olduğunu iddia ediyor ("en iyi", "1 numaralı", "Türkiye\'nin en …").',
  }),
  hedef_kitle: choice(`${SITE} hangi işletmelere sesleniyor?`, {
    kuafor_berber: 'Ağırlıkla kuaför ve berberler.',
    guzellik_merkezi: 'Ağırlıkla güzellik merkezi, tırnak, cilt, estetik işletmeleri.',
    klinik_saglik: 'Ağırlıkla klinik, diyetisyen, psikolog gibi sağlık/danışmanlık işletmeleri.',
    genel_randevulu_isletme: 'Randevuyla çalışan her tür işletmeye genel olarak.',
  }),
  ana_vaat: choice(`${SITE} en çok hangi faydayı vaat ediyor?`, {
    zaman_kazanma: 'Telefon ve mesajla uğraşmayı azaltıp zaman kazandırmak.',
    gelir_artisi: 'Daha çok randevu, daha çok müşteri, daha çok ciro.',
    gelmeme_azaltma: 'Hatırlatmalarla gelmeyen müşteriyi ve boş saati azaltmak.',
    musteri_deneyimi: 'Müşterinin kolayca, 7/24 randevu alabilmesi.',
    duzen_kontrol: 'Takvim, personel, kasa ve raporlarla işletmeyi tek yerden yönetmek.',
    maliyet: 'Ucuz olmak ya da tasarruf ettirmek.',
    kolaylik: 'Kullanmanın ve başlamanın kolay olması, az uğraş.',
    hepsi_bir_arada: 'Tek bir faydayı değil, özellik genişliğini ("hepsi bir arada") öne çıkarmak.',
  }),
  birincil_cta: choice('`sayfalar` içindeki CTA metinlerine göre ziyaretçiden birincil olarak ne yapması isteniyor?', {
    ucretsiz_basla: 'Hemen ücretsiz başlamak / kayıt olmak.',
    demo_iste: 'Demo ya da tanıtım istemek.',
    bizi_arayin: 'Satış ekibiyle konuşmak, aranmak, iletişime geçmek.',
    uygulama_indir: 'Mobil uygulamayı indirmek.',
    fiyat_gor: 'Fiyatlara ya da paketlere bakmak.',
    kurulum_destegi: 'Kurulumu işletme adına yaptırmak, birlikte kurmak.',
    belirsiz: 'Belirgin bir birincil çağrı yok.',
  }),
  teklif: choice('`sayfalar` içindeki fiyat satırlarına ve CTA\'lara göre öne çıkan ticari teklif nedir?', {
    ucretsiz_deneme: 'Süreli ücretsiz deneme.',
    ucretsiz_plan: 'Süresiz ücretsiz paket.',
    indirim_kampanya: 'İndirim, kampanya ya da yıllık ödeme avantajı.',
    sinirsiz: '"Sınırsız randevu" gibi sınırsızlık vaadi.',
    tek_fiyat: 'Tüm özellikler dahil tek fiyat.',
    yok: 'Belirgin bir teklif yok.',
  }),
  farkindalik: score(`${HERO} ziyaretçinin hangi farkındalık aşamasında olduğunu varsayıyor?`, [
    'Habersiz: sorunu ya da çözümü adlandırmadan genel bir durumdan söz ediyor.',
    'Sorun farkında: işletmenin yaşadığı sorunu adlandırıyor.',
    'Çözüm farkında: online randevu sistemini bir kategori olarak anlatıyor.',
    'Ürün farkında: bu ürünün diğerlerinden neden daha iyi olduğunu anlatıyor.',
    'En farkında: doğrudan fiyat, teklif ya da kampanyayla konuşuyor.',
  ]),
  netlik: score(`Bir salon sahibi ${HERO} okuyunca ürünün ne olduğunu ve kendisine ne kazandıracağını beş saniyede anlar mı?`, [
    'Hayır; ne satıldığı anlaşılmıyor.',
    'Ne satıldığı anlaşılıyor ama faydası belirsiz.',
    'Ne satıldığı ve faydası anlaşılıyor ama genel.',
    'Ne satıldığı ve somut faydası hemen anlaşılıyor.',
  ]),
  farklilasma: score(`${SITE} "online randevu sistemi / salon programı" diyen genel iddialardan ne kadar ayrışıyor?`, [
    'Hiç ayrışmıyor; herhangi bir rakip aynı cümleleri kurabilir.',
    'Az ayrışıyor; küçük bir özellik farkı var.',
    'Belirgin ayrışıyor; açık bir konum ya da yaklaşım var.',
    'Çok ayrışıyor; yalnız bu markaya ait, akılda kalan bir iddia var.',
  ]),
  kanit_sayi: noul(`${ANY} sosyal kanıt veriyor mu?${MEANING}`, 'Kaç işletmenin ya da kullanıcının kullandığı, puan, müşteri yorumu ya da referans logoları gibi sosyal kanıt var.', 'Sosyal kanıt yok. Fiyatlar, paket limitleri, deneme süreleri ve örnek ekran rakamları kanıt sayılmaz.'),
  whatsapp: noul(`${ANY} WhatsApp'ı bir özellik ya da kanal olarak öne çıkarıyor mu?${MEANING}`, 'WhatsApp bildirimi, WhatsApp entegrasyonu ya da WhatsApp desteği anılıyor.', 'WhatsApp anılmıyor.'),
  yapay_zeka: noul(`${ANY} yapay zekâyı bir özellik olarak öne çıkarıyor mu?${MEANING}`, 'Yapay zekâ, AI asistan, akıllı öneri gibi bir özellik anılıyor.', 'Yapay zekâ anılmıyor.'),
  kurulum_destegi: noul(`${ANY} sistemi işletmenin yerine firmanın kuracağını ya da birlikte kuracaklarını söylüyor mu?${MEANING}`, 'Kurulum, ayarlar ya da veri aktarımı firma tarafından veya işletmeyle birlikte yapılıyor ("biz kuralım", "sen uğraşma" gibi).', 'Kurulumu işletme kendisi yapıyor ya da kurulumdan hiç söz edilmiyor.'),
  fiyat_acik: noul('`sayfalar` içindeki fiyat satırlarında somut bir fiyat rakamı görünüyor mu?', 'En az bir paketin TL ya da döviz cinsinden fiyatı yazıyor.', 'Fiyat rakamı yok ya da yalnız "ücretsiz" deniyor.'),
  mobil_uygulama: noul(`${ANY} işletme için bir mobil uygulama sunduğunu söylüyor mu?${MEANING}`, 'iOS/Android uygulaması ya da mobil uygulama anılıyor.', 'Mobil uygulama anılmıyor.'),
  hatirlatma: noul(`${ANY} müşteriye randevusunun hatırlatıldığını söylüyor mu?${MEANING}`, 'Müşteriye randevusu hatırlatılıyor; kanal (SMS, e-posta, WhatsApp) ya da "otomatik" kelimesi geçmese bile.', 'Randevu hatırlatmasından söz edilmiyor.'),
  odeme_kapora: noul(`${ANY} online ödeme ya da kapora almayı sunuyor mu?${MEANING}`, 'Online ödeme, kapora ya da ön ödeme anılıyor.', 'Online ödeme ya da kapora anılmıyor.'),
  yerel_destek: noul(`${ANY} Türkiye'ye özgü ya da yerel/Türkçe destek vurgusu yapıyor mu?${MEANING}`, 'Türkçe destek, yerli ekip, Türkiye\'deki işletmeler gibi yerel bir vurgu var.', 'Yerel ya da Türkçe destek vurgusu yok.'),
};

// Bileşik "mesaj gücü" — ağırlıklar burada, prompt'ta değil.
const WEIGHTS = { netlik: 0.4, farklilasma: 0.4, kanit_sayi: 0.2 };

// ---------------------------------------------------------------- veri

// Material ikon adları ("play_arrow", "content_cut") metne karışabiliyor.
const clean = (value) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : String(value ?? '').replace(/\b[a-z]+(?:_[a-z]+)+\b/g, '').replace(/\s+/g, ' ').trim());

function compact(site) {
  // Hata ve bot koruması sayfaları (403 "Access Denied") analiz edilmez.
  const pages = site.sayfalar.filter((p) => !p.error && !(p.status >= 400));
  if (!pages.length) return null;
  const [home] = pages;
  return {
    sirket: site.ad,
    ana_sayfa: { baslik: clean(home.baslik), meta: clean(home.meta), h1: clean(home.h1?.join(' / ')), hero_alt: clean(home.hero_alt) },
    sayfalar: pages.map((p) => ({ url: p.url, h1: clean(p.h1?.join(' / ')), alt_metin: clean(p.hero_alt), basliklar: clean(p.basliklar ?? []), ctalar: clean(p.ctalar ?? []), fiyat: clean(p.fiyat ?? []), diger: clean(p.diger ?? []) })),
  };
}

const sites = [JSON.parse(readFileSync(new URL('bizim.json', here), 'utf8'))];
const dir = new URL('sayfalar/', here);
if (!args['yalniz-bizim'] && existsSync(dir)) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) sites.push(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
}

// ---------------------------------------------------------------- çalıştır

const rows = [];
for (const site of sites) {
  const state = compact(site);
  if (!state) { rows.push({ ad: site.ad, hata: 'erişilebilir sayfa yok' }); continue; }
  try {
    const res = await client.systemOne({ model: args.model, state, questions: QUESTIONS });
    rows.push({ ad: site.ad, state, answers: res.answers, tokens: res.usage?.input_tokens ?? 0, model: res.model });
  } catch (error) {
    rows.push({ ad: site.ad, hata: `${error?.name}: ${error?.message}` });
  }
}

// ---------------------------------------------------------------- rapor

const ok = rows.filter((r) => r.answers);
const us = ok.find((r) => r.ad.startsWith('Randevu'));
const rivals = ok.filter((r) => r !== us);
const val = (r, k) => {
  const a = r.answers[k];
  if (a.type === 'choice') return a.choice;
  if (a.type === 'score') return a.score;
  return a.noul;
};
const strength = (r) => WEIGHTS.netlik * (val(r, 'netlik') / 3) + WEIGHTS.farklilasma * (val(r, 'farklilasma') / 3) + WEIGHTS.kanit_sayi * val(r, 'kanit_sayi');
const cell = (r, k) => {
  const a = r.answers[k];
  if (a.type === 'choice') return `${a.choice}${a.confidence < 0.6 ? ' (?)' : ''}`;
  if (a.type === 'score') return `${a.score.toFixed(1)}${a.confidence < 0.6 ? ' (?)' : ''}`;
  return a.noul >= 0.5 ? `✓ ${a.noul.toFixed(2)}` : `· ${a.noul.toFixed(2)}`;
};

const L = [];
L.push(`# Rakip mesaj analizi — ${new Date().toISOString()}`, '');
if (args.mock) L.push('> **MOCK — gerçek sonuç değildir.**', '');
L.push(`Model: ${[...new Set(ok.map((r) => r.model))].join(', ') || '—'} · site: ${rows.length} (analiz edilen ${ok.length}) · soru/site: ${Object.keys(QUESTIONS).length} · toplam token: ${ok.reduce((s, r) => s + r.tokens, 0)} · maliyet ≈ $${((ok.reduce((s, r) => s + r.tokens, 0) / 1e6) * 0.042).toFixed(4)}`);
L.push('`(?)` = güven < 0.6, elle kontrol edilmeli. Nouller: ✓ = olasılık ≥ 0.5.', '');
for (const r of rows.filter((r) => r.hata)) L.push(`- ${r.ad}: ${r.hata}`);
L.push('', '## Konum matrisi', '');
const choiceKeys = ['acilis_tipi', 'hedef_kitle', 'ana_vaat', 'birincil_cta', 'teklif'];
const scoreKeys = ['farkindalik', 'netlik', 'farklilasma'];
const noulKeys = Object.keys(QUESTIONS).filter((k) => QUESTIONS[k].type === 'noul');
L.push(`| Site | ${choiceKeys.join(' | ')} | ${scoreKeys.join(' | ')} | mesaj gücü |`);
L.push(`|---|${choiceKeys.map(() => '---').join('|')}|${scoreKeys.map(() => '---').join('|')}|---|`);
for (const r of [...ok].sort((a, b) => strength(b) - strength(a))) {
  L.push(`| ${r === us ? `**${r.ad}**` : r.ad} | ${choiceKeys.map((k) => cell(r, k)).join(' | ')} | ${scoreKeys.map((k) => cell(r, k)).join(' | ')} | ${strength(r).toFixed(2)} |`);
}
L.push('', `| Site | ${noulKeys.join(' | ')} |`, `|---|${noulKeys.map(() => '---').join('|')}|`);
for (const r of ok) L.push(`| ${r === us ? `**${r.ad}**` : r.ad} | ${noulKeys.map((k) => cell(r, k)).join(' | ')} |`);

if (rivals.length) {
  L.push('', '## Rakiplerin ortak dili ve boş alanlar', '');
  for (const k of choiceKeys) {
    const counts = {};
    for (const r of rivals) counts[val(r, k)] = (counts[val(r, k)] ?? 0) + 1;
    const unused = Object.keys(QUESTIONS[k].criteria).filter((o) => !counts[o]);
    L.push(`- **${k}:** ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(', ')}${unused.length ? ` · kimse kullanmıyor: ${unused.join(', ')}` : ''}${us ? ` · bizim: ${val(us, k)}` : ''}`);
  }
  for (const k of noulKeys) {
    const n = rivals.filter((r) => val(r, k) >= 0.5).length;
    L.push(`- **${k}:** ${n}/${rivals.length} rakip${us ? ` · bizim: ${val(us, k) >= 0.5 ? 'var' : 'yok'} (${val(us, k).toFixed(2)})` : ''}`);
  }
}

const out = new URL(`results/${new Date().toISOString().replace(/[:.]/g, '-')}${args.mock ? '-mock' : ''}/`, here);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('report.md', out), L.join('\n') + '\n');
writeFileSync(new URL('raw.json', out), JSON.stringify(rows, null, 2));
console.log(L.join('\n'));
console.log(`\nRapor: ${new URL('report.md', out).pathname}`);

async function mockFetch(_url, init) {
  const body = JSON.parse(init.body);
  const answers = {};
  for (const [k, q] of Object.entries(body.questions)) {
    if (q.type === 'choice') { const c = Object.keys(q.criteria)[0]; answers[k] = { type: 'choice', choice: c, confidence: 0.7, probabilities: { [c]: 0.7 } }; }
    else if (q.type === 'score') answers[k] = { type: 'score', score: 1.5, confidence: 0.7, legend: {}, probabilities: {} };
    else answers[k] = { type: 'noul', noul: 0.3 };
  }
  return new Response(JSON.stringify({ model: 'mock', answers, usage: { input_tokens: Math.ceil(init.body.length / 4), output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}
