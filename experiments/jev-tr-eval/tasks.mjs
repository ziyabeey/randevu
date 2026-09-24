// Jev'e sorulacak üç karar: niyet, hizmet eşleştirme, saat seçimi.
// Varyantlar:
//   duz          — yalnız kısa etiket açıklamaları
//   hazirlanmis  — randevu alanına özgü Türkçe ifadeler ve kurallar eklenmiş açıklamalar
//   baglamli     — (niyet) hazirlanmis + botun bekleyen sorusu yoksa onay/ret seçenekleri sunulmaz
//   salon        — (hizmet) hazirlanmis + salonun kataloguna girdiği halk ağzı adlar
// Test setleri: 1 = ilk set; 2 = 1. turun hatalarına bakılarak yapılan değişikliklerden SONRA yazılmış yeni set.
// Hazırlık örnekleri test setindeki mesajların birebir kopyası değildir (sızıntı olmasın diye).
// Soru adı modele gitmez; talimatlar state alanlarına `musteri_mesaji` gibi adıyla atıf yapar
// (Jev-Mem'in memory/jev_questions.py dosyasındaki soru yazım kuralı).

import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const readJsonl = (name) => readFileSync(new URL(`data/${name}`, here), 'utf8')
  .split('\n').filter(Boolean).map((line) => JSON.parse(line));
const dataFile = (base, set) => (String(set) === '2' ? `${base}-2.jsonl` : `${base}.jsonl`);

export const VARIANTS = ['duz', 'hazirlanmis', 'baglamli', 'salon'];

// Onay/ret ancak botun cevap beklediği bir soru varken anlamlıdır.
const CONFIRMATION_LABELS = ['onay', 'ret'];

// ---------------------------------------------------------------- niyet

const INTENT_PLAIN = {
  randevu_al: 'Müşteri yeni bir randevu almak ya da boş saat öğrenmek istiyor',
  randevu_tasi: 'Müşteri mevcut randevusunun gününü veya saatini değiştirmek istiyor',
  randevu_iptal: 'Müşteri mevcut randevusunu iptal etmek istiyor veya gelemeyeceğini bildiriyor',
  gecikme: 'Müşteri randevusuna geç kalacağını veya yolda olduğunu bildiriyor',
  fiyat_sorusu: 'Müşteri fiyat, ücret, indirim veya kampanya soruyor',
  bilgi_sorusu: 'Müşteri adres, çalışma saatleri, hizmetler, ödeme yöntemi veya kendi randevusu hakkında bilgi soruyor',
  onay: 'Müşteri salonun önerisini ya da sorusunu kabul ediyor veya randevuya geleceğini teyit ediyor',
  ret: 'Müşteri salonun önerisini ya da sorusunu reddediyor',
  sikayet: 'Müşteri hizmetten veya salondan şikayet ediyor, memnun değil',
  memnuniyet: 'Müşteri teşekkür ediyor veya memnuniyetini bildiriyor',
  insan_istiyor: 'Müşteri bir insanla veya yetkiliyle konuşmak ya da aranmak istiyor',
  diger: 'Randevuyla ilgisiz, spam, selamlaşma veya anlaşılmayan mesaj',
};

const INTENT_EXAMPLES = {
  randevu_al: ["Perşembeye yer var mı", "boyaya gelmek istiyorum", "bana bi saat verir misiniz", "akşam müsaitseniz uğrayayım"],
  randevu_tasi: ["saati değiştirebilir miyiz", "bir gün sonraya atalım", "randevumu öne alın", "o gün olmuyor başka gün verin"],
  randevu_iptal: ["gelemicez iptal edelim", "randevuyu kapatın", "o gün orada olamam", "vazgeçtim gelmicem"],
  gecikme: ["biraz geç kalıcam", "yoldayım geliyorum", "trafik var 10 dk", "az bekleyin geliyorum"],
  fiyat_sorusu: ["kaç lira", "ücretiniz nedir", "ne kadar tutuyor", "indirim yapıyor musunuz"],
  bilgi_sorusu: ["neredesiniz", "kaça kadar açıksınız", "kartla ödeyebilir miyim", "benim randevum hangi gündü"],
  onay: ["olur", "tamam", "evet", "uyar", "ayarlayın", "orada olacağım"],
  ret: ["olmaz", "yok", "uymuyor", "istemiyorum", "başka saat olsun", "kalsın"],
  sikayet: ["hiç beğenmedim", "çok beklettiniz", "rezil oldum", "eline sağlık(!) berbat olmuş"],
  memnuniyet: ["çok güzel olmuş", "emeğinize sağlık", "tşk", "bayıldım", "gayet iyiydi"],
  insan_istiyor: ["bir yetkili", "beni arayın", "gerçek kişi", "salon sahibi", "bot istemiyorum"],
  diger: ["selam", "reklam/spam", "iş başvurusu", "yanlış numara", "anlamsız mesaj"],
};

const INTENT_INSTRUCTIONS = {
  duz: 'Bir kuaför/güzellik salonuna gelen `musteri_mesaji` hangi niyeti taşıyor? Varsa `botun_onceki_mesaji` bu mesajdan hemen önce salonun sorduğu sorudur.',
  hazirlanmis: [
    'Bir kuaför/güzellik salonuna WhatsApp\'tan gelen `musteri_mesaji` hangi niyeti taşıyor?',
    'Varsa `botun_onceki_mesaji` salonun hemen önce sorduğu sorudur: "olur", "yok", "evet" gibi kısa cevaplar o soruya verilen cevaptır.',
    'Türkçe olumsuzluk eklerine dikkat et: "gelebilirim" ile "gelemem" zıt anlamlıdır; "iptal etmeyin" iptal değildir.',
    'Randevuya gelemeyeceğini söyleyip yeni gün öneren müşteri taşıma istiyordur.',
    'İronik övgü ("bravo", "harika" + olumsuz bir olay) şikayettir.',
    'Yazım hataları, Türkçe karakter eksikliği ve emoji olağandır.',
  ].join(' '),
};

function intentCriteria(variant, item) {
  if (variant === 'duz') return { ...INTENT_PLAIN };
  if (variant === 'baglamli') {
    const criteria = intentCriteria('hazirlanmis');
    if (!item.context) for (const label of CONFIRMATION_LABELS) delete criteria[label];
    return criteria;
  }
  return Object.fromEntries(Object.entries(INTENT_PLAIN).map(([label, text]) => [
    label, `${text}. Tipik ifadeler: ${INTENT_EXAMPLES[label].map((e) => `"${e}"`).join(', ')}`,
  ]));
}

// ---------------------------------------------------------------- hizmet

const catalog = JSON.parse(readFileSync(new URL('data/service-catalog.json', here), 'utf8'));

const SERVICE_SYNONYMS = {
  kesim_kadin: 'kadın kesim, küt, katlı kesim',
  kesim_erkek: 'erkek kesim, çocuk kesim',
  sakal: 'sakal şekillendirme',
  fon: 'bukle, düzleştirme, saç şekillendirme',
  dip_boya: 'kök boyası',
  tum_boya: 'renk değişimi',
  balyaj: 'meç, highlight',
  keratin: 'saç botoksu, düzleştirici bakım',
  manikur: 'el bakımı',
  pedikur: 'ayak tırnakları',
  kalici_oje: 'uzun süre kalan oje',
  protez_tirnak: 'akrilik tırnak',
  kas: 'kaş şekillendirme',
  agda: 'sir ağda',
  lazer: 'buz lazer',
  gelin: 'gelin başı',
  makyaj: 'profesyonel makyaj',
  cilt: 'hydrafacial',
};

// Salonun katalogda hizmete eklediği kendi müşterilerinin kullandığı adlar (1. turun hatalarından).
const SALON_SYNONYMS = {
  keratin: 'brezilya fönü',
  balyaj: 'röfle',
  kesim_erkek: 'çocuk tıraşı',
  protez_tirnak: 'tırnak uzatma',
};

function serviceCriteria(variant) {
  const criteria = {};
  for (const [label, name] of Object.entries(catalog.services)) {
    if (variant === 'duz') {
      criteria[label] = name;
    } else {
      const synonyms = [SERVICE_SYNONYMS[label], variant === 'salon' ? SALON_SYNONYMS[label] : null].filter(Boolean);
      criteria[label] = `${name} (${synonyms.join(', ')})`;
    }
  }
  criteria[catalog.none_label] = catalog.none_description;
  return criteria;
}

const SERVICE_INSTRUCTIONS = {
  duz: '`musteri_mesaji` salonun hangi hizmetini istiyor?',
  hazirlanmis: '`musteri_mesaji` salonun hangi hizmetini istiyor? Kuaför dilindeki eş anlamlı ve halk ağzı adları dikkate al. '
    + 'Katalogda gerçek karşılığı yoksa "yok" seç; benzer ama farklı bir hizmeti seçme.',
};

// ---------------------------------------------------------------- saat

const SLOT_INSTRUCTIONS = {
  duz: '`botun_onceki_mesaji` içinde sunulan saatlerden `musteri_mesaji` hangisini istiyor? Şimdiki zaman `simdi` alanındadır.',
  hazirlanmis: [
    '`botun_onceki_mesaji` içinde sunulan saatlerden `musteri_mesaji` hangisini istiyor? Şimdiki zaman `simdi` alanındadır.',
    'Türkçe saat ifadeleri: "buçuk" = :30, "çeyrek geçe" = :15, "çeyrek kala" = bir önceki saatin :45\'i (beşe çeyrek kala = 16:45).',
    'Salon bağlamında 1–8 arası saatler genelde öğleden sonradır ("7de" = 19:00).',
    '"Bugün", "yarın", "haftaya", "önümüzdeki" ifadelerini `simdi` alanına göre hesapla.',
    'İstenen saat listede birebir yoksa "hicbiri" seç; yakın bir saati kendin uydurma.',
  ].join(' '),
};

INTENT_INSTRUCTIONS.baglamli = INTENT_INSTRUCTIONS.hazirlanmis;
SERVICE_INSTRUCTIONS.salon = SERVICE_INSTRUCTIONS.hazirlanmis;

function slotCriteria(item) {
  return { ...item.offered, hicbiri: 'Müşterinin istediği zaman bu saatlerin hiçbirine uymuyor ya da net değil; tekrar sorulmalı' };
}

// ---------------------------------------------------------------- görev tanımları

export const TASKS = {
  niyet: {
    variants: ['duz', 'hazirlanmis', 'baglamli'],
    items: (set) => readJsonl(dataFile('intent', set)),
    // baglamli varyantta onay/ret sunulmadığında beklenen cevap da ondan arınır.
    accept(item, variant) {
      if (variant !== 'baglamli' || item.context) return item.accept;
      const accept = item.accept.filter((label) => !CONFIRMATION_LABELS.includes(label));
      return accept.length ? accept : ['diger'];
    },
    request(item, variant) {
      const state = item.context
        ? { botun_onceki_mesaji: item.context, musteri_mesaji: item.message }
        : { musteri_mesaji: item.message };
      return { state, question: { type: 'choice', instructions: INTENT_INSTRUCTIONS[variant], criteria: intentCriteria(variant, item) } };
    },
  },
  hizmet: {
    variants: ['duz', 'hazirlanmis', 'salon'],
    items: (set) => readJsonl(dataFile('service', set)),
    request(item, variant) {
      return {
        state: { musteri_mesaji: item.message },
        question: { type: 'choice', instructions: SERVICE_INSTRUCTIONS[variant], criteria: serviceCriteria(variant) },
      };
    },
  },
  saat: {
    variants: ['duz', 'hazirlanmis'],
    items: (set) => readJsonl(dataFile('slot', set)),
    request(item, variant) {
      const offered = Object.values(item.offered).join(', ');
      return {
        state: { simdi: item.now, botun_onceki_mesaji: `Şu saatler uygun: ${offered}. Hangisini istersiniz?`, musteri_mesaji: item.message },
        question: { type: 'choice', instructions: SLOT_INSTRUCTIONS[variant], criteria: slotCriteria(item) },
      };
    },
  },
};
