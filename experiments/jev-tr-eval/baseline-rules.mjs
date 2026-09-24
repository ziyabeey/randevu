// Niyet görevi için bilerek basit tutulmuş anahtar kelime kuralları.
// Amaç Jev'le karşılaştırılacak ücretsiz bir alt sınır vermek; olumsuzluk ve ironi gibi
// durumlarda yanılması beklenir.

const fold = (text) => text.toLocaleLowerCase('tr-TR')
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
  .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');

const has = (text, patterns) => patterns.some((p) => p.test(text));

const NO = [/\bhayir\b/, /\byok\b/, /\bolmaz\b/, /kalsin/, /istemiyorum/, /olmuyor/, /olmasin/, /gerek yok/, /dusuneyim/, /erken bana/];
const YES = [/\bolur/, /tamam/, /\bevet\b/, /uygun/, /aynen/, /^he$/, /onayl/, /ayirin/, /super/, /gelecegim/, /\bolsun\b/, /👍/];
const HUMAN = [/yetkili/, /gercek biri/, /insan/, /arayabilir/, /sahib/, /mudur/, /canli destek/, /telefon numara/, /makine/, /ulassin/, /bana doner/];
const MOVE = [/ertele/, /kaydir/, /degistir/, /cekebilir/, /cekmek/, /yerine/, /ileri at/, /erkene/, /alabilir miyiz/, /alabilirmisiniz/, /ertesi gun/, /aksam \d+da/];
const CANCEL = [/iptal/, /gelemeyecegim/, /gelemicem/, /gelemiycem/, /gelemem/, /gelemiyorum/, /olamayacagim/, /vazgectim/, /\bsil/, /unutun/, /gelmiyorum/, /gelmeyecegim/];
const LATE = [/gecik/, /gec kal/, /yoldayim/, /trafik/, /birazdan/, /rotar/, /\bdk\b/, /koseded/, /geliyorum/];
const PRICE = [/fiyat/, /ucret/, /kac tl/, /kac lira/, /kac para/, /ne kadar/, /tutar/, /indirim/, /kampanya/];
const COMPLAINT = [/rezalet/, /berbat/, /memnun degil/, /soyuld/, /kaba/, /geri istiyorum/, /bekledim/, /yanlis renk/, /dokuldu/, /rezil/, /ne bicim/, /cikmiyorsunuz/, /asimetrik/, /unutmussunuz/];
const THANKS = [/tesekkur/, /tskler/, /saglik/, /bayildim/, /harika/, /mukemmel/, /memnun kaldim/, /begendim/, /❤/, /iyi ki/, /fena olmamis/, /muhtesem/];
const INFO = [/adres/, /nere/, /acik mi/, /kapan/, /otopark/, /kart/, /yapiyor musunuz/, /veriyor musunuz/, /konum/, /kac dakika/, /marka/, /instagram/, /sakincali/, /kapora/, /randevusuz/, /randevum var mi/, /kactaydi/];
const BOOK = [/randevu/, /musait/, /yer var/, /yeriniz/, /gelebilir miyim/, /yazin/, /istiyorum/, /bos saat/, /ayirir/, /lazim/];

export function ruleIntent(message, context) {
  const text = fold(message).trim();
  if (context) {
    if (has(text, NO)) return 'ret';
    if (has(text, YES)) return 'onay';
  }
  if (has(text, HUMAN)) return 'insan_istiyor';
  if (has(text, CANCEL)) return has(text, MOVE) || /gelebilirim/.test(text) ? 'randevu_tasi' : 'randevu_iptal';
  if (has(text, MOVE)) return 'randevu_tasi';
  if (has(text, LATE)) return 'gecikme';
  if (has(text, COMPLAINT)) return 'sikayet';
  if (has(text, PRICE)) return 'fiyat_sorusu';
  if (has(text, THANKS)) return 'memnuniyet';
  if (has(text, INFO)) return 'bilgi_sorusu';
  if (has(text, BOOK)) return 'randevu_al';
  return 'diger';
}
