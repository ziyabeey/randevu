# Jev sentezi — ne öğrendik, nerede kullanırız, hangi kurallarla (24 Eylül 2026)

Model `jev-1.13.0` (TypeSafe System One). Tüm ölçümler bu klasörde tekrar üretilebilir; toplam API
maliyeti ≈ 10 sent. Ayrıntılar: [`BULGULAR.md`](BULGULAR.md), [`r0/BULGULAR.md`](r0/BULGULAR.md),
[`rakip/ANALIZ.md`](rakip/ANALIZ.md), [`COOKBOOK-HARITASI.md`](COOKBOOK-HARITASI.md), [`raporlar/`](raporlar/).

## 1. Ölçülen gerçekler

| Deney | Veri | Sonuç |
|---|---|---|
| Türkçe niyet (12 seçenek) | 183 + 65 sentetik mesaj | **%98.3**, önceden görülmemiş sette de %98.3. Aynı işi yapan anahtar kelime kuralları yeni sette %93.6 → **%55** |
| Güven değeri | niyet, 0.8 eşiği | Kararların ~%90'ı otomatik, otomatiklerin doğruluğu %98–100. Doğru ort. güven ~0.95, yanlış ~0.5–0.6 |
| Bağlama göre seçenek | botun sorusu yokken "tamam", "Evet", "👌" | Seçenek sunulunca 0.93–1.00 güvenle yanlış "onay"; sunulmayınca hepsi eşik altı (%0 → %100 doğru durma) |
| Hizmet eşleştirme | 30 + 26 mesaj | Düz %87.5 → genel eş anlamlılar %95.8 → salonun kendi adlarıyla **%100** (yeni set) |
| Saat seçimi (tek Choice) | 31 + 19 mesaj | %85.7 / %94.4; ≥ 0.8 güvende hata 0 |
| Saat seçimi (parçalara ayır + kod) | aynı | **Aynı doğruluk**, 3.8× token, otomatik oran %75 → %18 |
| R0 inceleme yorumları | 230 gerçek yorum, 133 PR | Copilot'ta regex %74.9, Jev %97.7. Ekip yorumlarında regex %87.3, Jev %80.0. Çelişki işareti (≥ 0.9): 51 regex hatasının 27'si, **0 yanlış alarm** |
| Rakip mesaj analizi | 9 rakip, 17 soru | Doğrulanabilir 120 cevabın 118'i elle etiketle aynı, maliyet 0.2 sent |
| Gecikme / maliyet | tümü | p50 ~300 ms, p95 ~500 ms; mesaj başı ~$0.00003 |

Tekrar çalıştırmada küçük setlerde ±1 örnek oynama görüldü; 1–2 örneklik farklar anlamlı sayılmadı.

## 2. Bilinen zayıflıklar (hem TypeSafe'in listesi hem bizim gözlemimiz)

| Zayıflık | Bizde görülen örnek |
|---|---|
| Kelimesi kelimesine okuma | "**tüm** başlıklar hatırlatmadan söz ediyor mu?" → "hayır" (0.07); "en az biri" deyince 0.95 |
| Kriter kelimeye bağlanınca | "otomatik hatırlatma (SMS…)" kriteri "Biz hatırlatırız" sloganını kaçırdı |
| Kriter dar yazılınca | "somut sayı" deyince fiyatları sosyal kanıt saydı |
| Süreç dili | "NEXT ACTION: R1 incelemesini başlat" → "açık sorun var" (düşük güvenle) |
| Tarih/saat hesabı | "dördü çeyrek geçe" listede yokken 16:45 (0.76) |
| Türkçe ikincil dil | Kalıplar kaçabiliyor: "keratinle fön birlikte **ne tutar**" → bilgi sorusu (0.83–0.99) |

Ortak ders: yanlışların büyük kısmı **sorunun yazılışından** çıktı ve düzeltilebildi. Düzeltmeler her
seferinde yeni veriyle ölçülmeli.

## 3. Deterministik kurallar

Jev bir **seçici**tir, karar verici değildir. Kod durumu, hesabı ve eylemi sahiplenir.

| # | Kural | Dayanak |
|---|---|---|
| K1 | Metnin biçimi bizim ya da bir botun kontrolündeyse Jev kullanılmaz; yapısal alan veya parser yazılır. | R1/R2 ayrıştırıcısı, Copilot başlığı |
| K2 | Jev yalnız **kapalı bir seçenek kümesinden** seçer; seçenekler o anki durumdan kurulur (bekleyen soru yoksa onay/ret yok; saatler müsaitlik RPC'sinden; hizmetler katalogdan). | Bağlamlı varyant, slot seçimi |
| K3 | Küme küçük ve sayılabilirse (≲ 50) **tek Choice**; parçalara ayırma yalnız uzay açıksa (serbest tarih, 255'ten büyük katalog). | Saat v1 ve v2 |
| K4 | Aritmetik, sayma, tarih karşılaştırma, fiyat hesabı **her zaman kodda**. | Jaggedness, saat hataları |
| K5 | Eşik eylem başına: taban 0.6 (altı → soru/insan); öneri ≥ 0.8; geri dönüşü zor eylem (randevu oluştur/iptal) ≥ 0.9 **ve** kullanıcı onayı. | Güven dağılımı, confidence-routing |
| K6 | Jev kurallı bir kararı geçersiz kılamaz; yalnız ≥ 0.9 güvenle **çelişki işareti** koyar, çelişki mevcut escalation yoluna düşer. | R0: 27/51, 0 yanlış alarm |
| K7 | Her soru önce doğru cevabı bilinen veride sınanır; kapsam kelimeleri, kelime avı ve dar kriter kontrol edilir. | Rakip rubriği, 3 düzeltme |
| K8 | Sürüm sabit (`jev-1.13.0`); her kararın girdisi, sürümü ve olasılıkları kaydedilir; aynı mesaj tekrar sorulmaz, kayıttan okunur. | ±1 oynama, alias değişebilir |
| K9 | İyileştirme, değişiklikten **sonra** yazılmış yeni setle ölçülür; kabul eşiği ölçümden önce yazılır. | Set 2 yöntemi |
| K10 | Jev erişilemezse sistem çalışmaya devam eder: kural/insan devri. Jev hiçbir akışın tek yolu değildir. | Erken sağlayıcı, SLA yok |
| K11 | **Çıkarılabilir olgu sezdirilmez.** Regex/AST/CFG/git/DB introspection ile çıkarılabilen olgu Jev'e keşif sorusu olarak sorulmaz; kod hesaplar. Olgular **betimleyicidir**: yapıyı ve konumu söyler, risk ya da hüküm söylemez (sözdizimi/yapı → kod). **Varsayılan sahiplik:** bu olgular kurallı dispatcher/kod katmanında kullanılır; Jev girdisine öncül olarak eklenmez. Verilen olgunun kendisi de bir ipucudur. Bir kullanım olguyu Jev'e vermek istiyorsa, aynı soru ve yeni vakalarda olgusuz kontrol koluna karşı ileriye dönük **ek katkı** önceden kaydedilip ölçülür (K9); ek değer gösterilmedikçe olgu model girdisinin dışında kalır. | H19a: tek `for update;` satırı D5'i etiketten ve "bağlamı sayma" talimatından bağımsız +0.20 itti. H19b′ (ön kayıtlı, 64 vaka): facts birincil çaprazda AUC'yi 0.86 → 0.82 düşürdü; skoru ipucu yönüne itti (C′ +0.058, D′ −0.136) |

## 4. Uygulama portföyü

| Alan | Durum | Kanıt | Sonraki deterministik adım | Kabul eşiği (önceden) |
|---|---|---|---|---|
| **Sohbet botu yönlendirici** (niyet + hizmet + saat) | Ölçüldü | %98.3 / %100 / %94.4 (sentetik) | Anonim gerçek mesajlarla ölçüm | ≥ 0.8 kararlarda doğruluk ≥ %98, otomatik oran ≥ %80 |
| **Geliştirme motoru çelişki işareti** (R0 yorumları) | Ölçüldü | 27/51, 0 yanlış alarm | Önce K1: parser düzeltmesi; Jev ikinci sinyal olarak gölge modda | Gölge modda 1 ay 0 yanlış alarm |
| **Pazarlama / rakip analizi** | Yapıldı | 118/120 | Aylık tekrar; site değişimini diff'le | Doğrulama uyumu ≥ %95 |
| F16-04 yorum moderasyonu | Ölçülmedi | Cookbook: %99.2 tutarlılık, %74 otomatik | Türkçe yorum seti + "emin değilim" seçeneği | Kişisel veri kaçırma 0 |
| Hizmet/masraf kategori önerisi | Ölçülmedi | Cookbook: emin değilse üst kategori | Gerçek katalog/masraf açıklamalarıyla ölçüm | Öneri kabul oranı ≥ %80 |
| Salon bilgisinden SSS cevabı | Ölçülmedi | Cookbook: satır bulma + "cevap var mı" | F12 randevu bilgisi metinleri üzerinde ölçüm | Cevabı olmayanı %100 salona devretme |

## 5. Riskler

- **Dil:** Türkçe ana eğitim dili değil; sonuçlarımız sentetik veride.
- **Sağlayıcı:** Şirket Eylül 2026'da çıktı, SLA yok, hız limitleri değişken.
- **Veri:** DPA var; sıfır saklama yalnız kurumsal planda. Müşteri mesajı göndermeden önce KVKK aydınlatma ve
  veri işleme sözleşmesi gerekli.
- **Kapsam:** AI MVP dışı; ürün kullanımı koordinatör kararı ve `TASKS.md` kaydı ister.

## 6. Önerilen karar

1. Jev'i **ürüne değil, önce geliştirme motoruna ve pazarlamaya** alın: müşteri verisi yok, kapsam dışı değil,
   ölçüm hazır.
2. Sohbet botunu **R&D önerisi** olarak açın (`rnd-issue-taslak.md`). Tek kanıt eksiği gerçek mesaj
   ölçümü; kabul eşiği yukarıda yazılı.
3. Ürüne girecek her Jev kullanımı K1–K11'e uymalı; bu kurallar kod incelemesinde kontrol listesi olur.
