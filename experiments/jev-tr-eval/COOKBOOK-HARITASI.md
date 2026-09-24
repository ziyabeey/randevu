# TypeSafe cookbook'ları → Randevu haritası (24 Eylül 2026)

Kaynak: `docs.typesafe.ai` altındaki 20 cookbook, 4 pattern sayfası, kullanım haritası, "Jev 1.13
jaggedness" ve Models sayfaları. Sonuç rakamları TypeSafe'in kendi yayımladığı sonuçlardır; bağımsız
doğrulanmamıştır.

## Modelin kendisi hakkında (Models + Jaggedness)

- `jev-1.13.0`: $0.042 / 1M girdi token, çıktı ücretsiz; 1.200 istek/dk; **32k token state + en uzun soru**
  (toplam 64k); yalnız metin.
- **Dil:** "English is the primary training language … test on your own content before relying on Jev for a
  non-English workload, and pay close attention to Confidence." → Bizim Türkçe ölçümlerimiz tam bunu yaptı.
- **İnce ayar yok:** müşteri verisiyle eğitilmez/LoRA yok; alan uyarlaması yalnız `state`, `instructions`,
  `criteria` ve soruları parçalamakla yapılır. "Önceden hazırlamak" = bizim yaptığımız açıklama hazırlığı.
- **Sürüm sabitle:** eşikler bir sürüme göre ayarlandıysa `jev-latest` yerine `jev-1.13.0` kullan.
- **Bilinen zayıflıklar:** kelimesi kelimesine okuma, sayma/aritmetik, **tarih-saat karşılaştırma**, çok
  adımlı dolaylama, alakasız detayla şişmiş state, kendi sınıflandırmasını savunan (adversarial) içerik,
  talimatla çelişen kriterler, metin üretimi.

## Cookbook'lar: kanıt ve Randevu'daki karşılığı

| Cookbook | TypeSafe'in gösterdiği | Yöntemin özü | Randevu'da karşılığı |
|---|---|---|---|
| **Date extraction** | Göreli/mutlak tarihleri parça parça okuyup kodda birleştirme; güven < 0.60 → insana | `mode`, ay, gün, yıl, gün çapası, hafta günü, hafta kaydırma ayrı `Choice`; "none"/"out_of_range" kaçışları; tarih güveni = parçaların en düşüğü | **Botun saat seçimi.** Bizim "dördü çeyrek geçe → 16:45" hatasının önerilen çözümü: gün/saat/dakika/gün dilimini ayrı seç, boş slotla eşleştirmeyi kod yapsın |
| **Function calling** | 14 doğal dil komutu → tipli fonksiyon + argüman | Kapalı kümeli her argüman bir `Choice`; isteğe bağlı argüman için ayrıca "söylendi mi?" `Noul`'u; fonksiyon seçimi + tüm argümanlar tek istekte; güven = en zayıf karar | **Bot eylemleri:** `randevu_al(hizmet, personel, gün, saat)`, `tasi`, `iptal`, `fiyat_sor(hizmet)`. Soru, parametre adına değil anlama göre yazılır |
| **Line-by-line search** | 218 satırlık metinde cevabın hangi satırda olduğunu bulma + "cevap var mı" | Satır kimlikleri `Choice` seçeneği (en fazla **255**); aynı istekte "doküman bu soruyu cevaplıyor mu" `Noul`'u | **Botun bilgi soruları:** "otopark var mı" → salonun kendi randevu bilgisi metninden (F12) ilgili satırı göster; cevap yoksa salona devret. Metin üretmeden SSS |
| **Guardrails** | Girdi/çıktı mesajlarını 4 tehlike `Noul`'u + 1 şiddet `Score`'u ile tek istekte tarama | Her tehlike için iki eşik (aksiyon / insan incelemesi); politika = eşik sayıları | **F16-04 yorum moderasyonu** ve bot girdisi: kişisel veri, hakaret, spam, sağlık iddiası; eşikler salon politikasına göre |
| **Self-consistency: choices** | Sınırda bir içerikte 15 tekrarda etiket tutarlılığı %90.8; top olasılık ≥ 0.60 şartıyla **%99.2 tutarlılık, %74.2 otomatik** | Moderasyon kararlarına "uncertain" çıkışı ekle | F16-04: "yayınla / gizle / salon karar versin" üçlüsü |
| **Classification using confidence** | Emin olunan (≥ 0.9) yarıda grup doğruluğu %90; emin olunmayan yarıda grup %40 → bir üst seviyede raporlayınca %70 | Hiyerarşide güven düşükse üst seviyeyi döndür | **Hizmet/masraf kategori önerisi:** emin değilse "Saç > Boya > Balyaj" yerine "Saç" öner |
| **Hierarchical classification** | Derin hiyerarşilerde beam search | `Choice` olasılıklarıyla katman katman arama | Büyük katalog / ortak hizmet taksonomisi eşlemesi |
| **Entity alignment** | 450 aday çiftin 360'ı otomatik "farklı", 40'ı "aynı", 50'si küratöre | Çift tek state'te; 1 `Score` (seviyeler = sonuçlar) + alan başına `Noul`; sayısal alan karşılaştırması kodda | **Mükerrer müşteri önerisi** (F10-05) ve katalog içe aktarmada hizmet eşleme; orta seviye = "salon baksın" |
| **Pre-parsed value extraction** | Regex adayları bulur, Jev doğru olanı seçer, kod normalize eder | Aday çıkarma kodda, seçim Jev'de | Mesajdaki telefon/e-posta/tutar; "bu numara benim mi yoksa kızımın mı" |
| **Parallel questions (fan-out)** | 13 soruyu tek istekte sormak **12.2× ucuz, 10× hızlı, cevaplar aynı** | Tüm soruları aynı state ile tek çağrıda | Bizim betikler her soruyu ayrı istekte soruyor; rakip analizinde tek istek |
| **Citation check** | 8 alıntıdan 4 doğru, 1 uydurma, 1 çelişkili, 2 desteksiz; ≥ 0.8 otomatik | Alıntı bulma kodda; "kaynak iddiayı destekliyor mu" tek `Choice` | **Pazarlama iddia kontrolü:** homepage/rakip metnindeki iddia, kabul edilmiş özellik kapılarıyla (`MARKETING_RELEASE_GATES`) destekleniyor mu? Faz 16 "var olmayan özellik canlıymış gibi gösterilmez" kuralı |
| **SDE cascade** | Küçük model çıkarır → Jev doğrular → yalnız işaretliler büyük modele; maliyet/kalite sınırı her tek modelden iyi | Doğrulayıcı olarak Jev, eşik taranarak | **Geliştirme motoru:** Haiku → Opus zincirinde "bu vaka gerçekten Opus gerektiriyor mu" kapısı |
| **Skill suggestion** | Yanlış skill yükleme %16.8 → %7.3, gereksiz yükleme %9.8 → %4.0 | Tüm listeyi ucuzca sırala, ilk 2-3'ü yakından kontrol et | Geliştirme motorunda görev → rol/skill seçimi (R1/R2 uygunluğu, kepenk-implementer vb.) |
| **Re-ranking** | Top-1 %5 → %18, top-5 %15 → %35 | Hızlı arama kısa listesi + çift başına Jev skoru | Yardım/SSS araması, salon bilgisi arama |
| **Autoresearch feature discovery** | Jev sorularını klasik modele özellik yapıp hatayı azaltma | Serbest metin → sayısal özellik | İleride: randevu notlarından gelmeme (no-show) riski özellikleri |
| Autoformat, RAG passages | Yapı kurtarma, pasaj filtreleme | — | Şimdilik düşük öncelik |

Kullanım haritasındaki **Advertising** maddesi doğrudan rakip analizi: "Evaluate creative assets, campaign
copy, landing pages … Check regulatory compliance and prohibited claims … ad-to-landing-page alignment."
**Semantic code linting** maddesi de "yazım kurallarını CI'da semantik lint olarak çalıştır" diyor.

## Pattern'lerden kurallar

- **Confidence-gated routing:** her şeyin altında 0.6 taban; üstünde **eylem başına eşik**. Bakiye göstermek
  0.6'da olur, para transferi > 0.85 ister, arada kullanıcıya onaylat. Bizde: bilgi sorusu 0.6, randevu
  oluşturma/iptal 0.85 + müşteri onayı.
- **Composite scoring:** karmaşık yargıyı atomik puanlara böl, ağırlıkları kodda tut; ağırlık değişince prompt
  değil katsayı değişir.
- **Intent routing:** gelen isteği kurallı işleyiciye, uzman LLM'e ya da insana yönlendir.
- **Speculative fan-out:** gerekebilecek soruları da aynı istekte sor; hangisinin kullanılacağına kod karar
  versin.

## Bizim deneylere taşınacak dersler

1. **Saat görevi yeniden tasarlanmalı:** slot listesinden seçtirmek yerine date-extraction yöntemi
   (parçalar + kodda eşleştirme + "listede yok" kodda). Beklenen etki: "çeyrek geçe/kala" hataları.
2. **Ekip R0 yorumlarındaki hata** jaggedness #1 (kelimesi kelimesine okuma): "sonraki süreç adımları ve
   devam eden CI açık sorun değildir" sınır durumu kritere yazılmalı; uzun yorumlar filtrelenmeli (#5).
3. **Tek istekte çok soru:** betiklerimiz soru başına istek atıyor; fan-out ile maliyet ve süre düşer.
4. **Eşikler eylem başına** olmalı; tek 0.8 eşiği yerine 0.6 taban + riskli eylemlere yüksek eşik.
5. **Sürüm sabitleme:** ölçümlerde ve üretimde `jev-1.13.0`.
6. **Score seviyelerini sonuç olarak yaz** (entity alignment): "birleştir / küratör baksın / ayrı" gibi;
   eşik sabitini sonradan uydurma.
