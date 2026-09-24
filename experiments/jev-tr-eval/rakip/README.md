# Rakip mesaj analizi (Jev)

Rakiplerin kamuya açık pazarlama sayfalarını Chromium ile açar, metni çıkarır ve her rakip için tek
istekte 17 atomik soru sorar (cookbook: *Parallel questions* + *Composite scoring*; kullanım haritası:
*Advertising*). Ağırlıklar kodda (`WEIGHTS`), sürüm `jev-1.13.0`'a sabit.

## Sorular

- **Choice:** açılış tipi, hedef kitle, ana vaat, birincil CTA, teklif
- **Score:** farkındalık aşaması (Schwartz 5 seviye), netlik (0–3), farklılaşma (0–3)
- **Noul:** somut kanıt/sayı, WhatsApp, yapay zekâ, kurulum desteği, fiyat açık mı, mobil uygulama,
  hatırlatma, online ödeme/kapora, yerel/Türkçe destek

## Ölçütlerin kendi metnimizde sınanması

Doğru cevabını bildiğimiz kendi homepage metnimizle (`bizim.json`, kaynak
`docs/brand/randevu-homepage-copy.md`) önce sınandı. Üç düzeltme gerekti:

1. **Eksik seçenek:** ana vaat listesinde "kolaylık / az uğraş" yoktu; bizim asıl vaadimiz buydu.
2. **Kelime avcılığı:** "otomatik hatırlatma (SMS, e-posta…)" kriteri "Unuttu mu? Biz hatırlatırız."
   sloganını kaçırdı (0.14). Kriterler anlama göre yazıldı ("kelime geçmese bile").
3. **Kapsam kelimesi:** "`sayfalar` içindeki **tüm** başlıklar … söylüyor mu?" Jev'e "hepsi mi" diye
   okundu (jaggedness #1). Evet/hayır soruları "en az biri" kapsamıyla yazıldı. Hatırlatma 0.07 → 0.95,
   kurulum desteği 0.35 → 0.97.

Sonrasında 17 cevabın hepsi doğru ya da makul; yalnız "farklılaşma" düşük güvenli (0.8, `(?)`).

## Çalıştırma

Rakip alan adları ortamın ağ izin listesinde olmalı (Custom → Allowed domains). Chromium'un proxy
sertifikasına güvenmesi için oturum başına bir kez:

```sh
apt-get install -y libnss3-tools
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n ccr-agent-proxy -i /root/.ccr/agent-proxy-ca.crt
```

```sh
cd experiments/jev-tr-eval
node rakip/collect.mjs                          # sayfalar/<rakip>.json
NODE_USE_ENV_PROXY=1 node rakip/analyze.mjs     # results/<zaman>/report.md
NODE_USE_ENV_PROXY=1 node rakip/analyze.mjs --yalniz-bizim
```

Reklam–açılış sayfası uyumu için reklam metinleri gerekir; Meta Reklam Kütüphanesi API'si AB dışındaki
ticari reklamları kapsamadığından bu sürümde yok.
