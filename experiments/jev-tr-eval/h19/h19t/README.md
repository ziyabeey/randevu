# H19t: vaka seti ve çalıştırma düzeni

- **Protokol:** [`../H19T-PROTOKOL.md`](../H19T-PROTOKOL.md), sürüm v0.1, mühürlü (58cf9ea; H19 sahibi).
- **Vaka üreticisi:** Claude.
- **Kör ikinci okuyucu:** H19 sahibi.

**Durum:** Vakalar donduruldu. **Hiçbir H19t Jev çağrısı yapılmadı.** İlk seed-1924 kör örnekleminin vaka kimlikleri üretici tarafından taslak aşamasında görülmüş olduğundan gate için kullanılmadı. H19 sahibi frozen setten ilk örneklemi tamamen dışlayarak bağımsız 16 vaka seçti; cevaplar `39c8bb569292d48f1a3568166d8540ab4d9ddb0c` commitinde etiketler açılmadan mühürlendi ve frozen etiketlerle 16/16 tam uyuştu. 0 vaka düştü; ölçüm kapısı açıktır.

```text
vakalar.v0.1.json sha256 60877b5f370e709f8b41aaab5858791f9aa64c6983ac73cfbf6f58f39999990a
```

| Dosya | İş |
|---|---|
| `vakalar.mjs` | 80 vaka tanımı: gerçek migration fonksiyonu, mutasyon, etiket, eksen(ler), yön (yalnız kayıt), aile, gerekçe |
| `kur.mjs` | Kurar ve protokol §2–§3'ü doğrular (matris, tekrar yasağı, denge, aile payı, naif özellik kapısı); bütün kapılar geçerse dondurur |
| `vakalar.v0.1.json` | **Donmuş set.** Betimleyici alanlar yalnız denge içindir; Jev'e verilmez |
| `vakalar.md` | Okunur liste |
| `ikinci-okuyucu.md` | **Kör kontrol, 16 vaka** (sabit tohum 1924): 4 PS, 4 PP (farklı eş eksenler), 4 NS, 4 NP. Katman ve etiket yok |
| `ikinci-okuyucu-anahtar.md` | Anahtar. Cevaplardan sonra açılmalı |
| `calistir.mjs` | V1 ve V2: 80 × 2 = 160 çağrı. Altı eksen sorusu aynen; facts yok, direction yok. **Çalıştırılmadı** |
| `analiz.mjs` | T1–T5 (§6–§8), §9 ikincil raporlar, §10 sonuç kuralı. Yalnız `P(D5) ≥ 0.64` ve `P(D5) ≥ 0.50` hesaplanır. V1'den önce yazıldı; yalnız sahte veriyle sınandı |

## Kör kontrolden sonra

1. `ikinci-okuyucu.md` doldurulup commit'lenir.
2. Uyuşmazlık çıkan vakalar `dusen.json` dosyasına yazılır (ör. `["PS03"]`). Vaka yeniden etiketlenmez;
   yenisiyle doldurulmaz.
3. `H19T_CASES_SHA256=<yukarıdaki> NODE_USE_ENV_PROXY=1 node h19/h19t/calistir.mjs`
4. `node h19/h19t/analiz.mjs h19/h19t/sonuc/<ts>`

## Matris (doğrulandı)

| Katman | Vaka | Dağılım |
|---|---|---|
| PS: D5 tek eksen | 20 | 10 weakens, 10 strengthens |
| PP: D5 + başka eksen | 20 | D0×D5, D1×D5, D2×D5, D3×D5, D4×D5 dörder |
| NS: D5 yok, tek eksen | 20 | D0–D4 dörder |
| NP: D5 yok, iki eksen | 20 | 10 çiftin her biri ikişer |

- **PP yön dağılımı:** 19 weakens, 1 strengthens (PP16).
  - H19t protokolü PP için yön dağılımı şart koşmuyor; yön yalnız kayıt.
  - H19d'deki "mümkünse 2 + 2" dağılımından sapma olarak ölçümden önce kaydedildi.
  - Temiz bir kilit/sürüm güçlendirmesini aynı fonksiyonda ikinci bir eksen değişikliğiyle birleştiren yeni adaylar
    sınırlıydı. Çoğu aday ya önceki setlerdeki bir mutasyonun kopyasıydı ya da etkisizdi (aynı kilit zaten
    başka yoldan alınıyordu).

## Denge ve naif özellik kapısı (protokol §3)

| | Pozitif | Negatif | Kural |
|---|---|---|---|
| `lock_context = true` | 29 | 32 | fark ≤ 4 ✓ |
| Diff'te (yol dahil) H19a ipucu sözlüğü | 30 | 27 | fark ≤ 4 ✓ |

| Naif özellik | genel AUC | PP–NP AUC |
|---|---|---|
| diff boyutu | 0.57 | 0.54 |
| eklenen satır | 0.64 | 0.64 |
| silinen satır | 0.50 | 0.52 |
| silinen where/and | 0.51 | 0.59 |
| eklenen exists/select | 0.53 | 0.55 |
| ipucu var | 0.54 | 0.63 |
| lock_context | 0.46 | 0.55 |
| removed-predicate var | 0.53 | 0.63 |

- Hepsi ≤ 0.70.
- "Eklenen exists/select" protokol §3'te listelendiği için bu sette kapıya dahil edildi. H19d bu alanı yalnız
  hesaplıyordu.
- Tek bir fonksiyon ailesi hiçbir katmanda %50'yi geçmiyor. En yüksek pay 9/20 (NS ve NP'de grup randevusu).

## Kurulum notları (ölçümden önce yazıldı)

1. **Tekrar yasağı, H19d'den daha sıkı uygulandı.** Otomatik kontrol şunları kapsıyor:
   - H19b, H19b′ ve H19d için fonksiyon + bul + değiştir üçlüsü;
   - R0/H19a, H19b, H19b′ ve H19d donmuş girdilerinin **hepsi** için değişen satır kümesi;
   - set içinde aynı değişen satır kümesinin tekrarı.

   80 vakanın 33'ü daha önce kullanılmış bir fonksiyon tanımını yeni bir mutasyonla kullanıyor
   (`function_reused`). Setin çoğu önceki setlerde hiç kullanılmamış migration'lardan geliyor:
   - ödeme defteri, ürün satışı;
   - KC-01 platform çekirdeği;
   - grup randevusu yönetimi ve kilit sırası onarımı;
   - randevu tarih aralığı, kurtarma, katalog saat limitleri.
2. **Fonksiyon gövdesi okuyucu.** `../h19b/extractor.mjs` H19b için dondurulmuş olduğundan değiştirilmedi.
   `kur.mjs` içindeki kopyası ek olarak şunları okuyor:
   - `create function` (or replace olmadan);
   - `core.` şeması;
   - rakam içeren `$etiket$`'ler.
3. **İlk kurulum dondurulmadı. Hiçbir model çağrısı yapmadan şu düzeltmeler yapıldı:**
   - **Tekrar yasağı:** 4 ihlal çıktı.
     - PS02 ile PS01, PS15 ile PS12, PS20 ile PS16 aynı değişen satır kümesini üretiyordu.
     - PS08 ilk sürümünde H19b E05'in mutasyonunu içeriyordu.
     - Hepsi değiştirildi.
   - **İpucu dengesi:** ilk kurulumda 34'e 15'ti.
     - Bazı pozitifler ipucu kelimesi taşımayan D5 mekanizmalarına taşındı: paylaşımlı satır kilidi, revizyon
       belirteci.
     - Bazı negatifler kilit/sürüm satırlarının yanına ya da adında "lock" geçen dosyaya taşındı.
     - Ardından kilit bağlamı dengesi 29'a 36 oldu. Dört negatif kilitsiz fonksiyonlara taşındı.
   - **PP09 ve PP11:** paylaşımlı kilit satırı `limit 1` ile değiştirildi. Böylece `where` satırı değişmeden
     kalıyor; bu, "removed-predicate" özelliğinin PP–NP ayrımını taşımasını engellemek içindi (önce 0.70
     sınırındaydı).
4. **Etiket gözden geçirmesi.** 80 vakanın hepsi aynı ölçütle okundu. Dondurmadan önce düzeltilenler:
   - **PS17:** ilk sürüm ürün iadesinde fiş sürümünü artırıyordu. Kapalı fişte `f14_guard_ticket_update`
     tetikleyicisi bunu `TICKET_IMMUTABLE` ile reddeder. Yani değişiklik saf D5 değildi (kapalı fişte iade
     bozulurdu). Grup durum güncellemesinde "kilidi kontrolden önce al" güçlendirmesiyle değiştirildi.
   - **PS04:** gerekçe düzeltildi. Ters kayıt FOR UPDATE aldığı için paylaşımlı kilitle serileşir; yarış iki
     eşzamanlı düzeltme arasındadır.
   - **NS13:** ilk sürümde temizlik partisi boyutuydu; D3 zayıftı. Grup doğrulamasında arşivlenmiş hizmet
     kabulüyle değiştirildi.
   - **NP05:** D3 değişikliği "süren tekrar hız sınırından muaf" idi. Eşzamanlılığa yakın olduğu için oluşturma
     isteğinin hız sınırının tamamen kaldırılmasıyla değiştirildi.
   - **PP07 ve NP14:** D1 değişikliği yalnız bir yanıt bayrağını çeviriyordu (`linked`/`created`). İkisi de
     "tekrar → çakışma hatası" değişikliğine çevrildi.
5. **Şeffaflık notu: kör örneklem.** Örneklem sabit tohumla katman içi konumdan seçilir. Vaka kimlikleri içerikten
   bağımsızdır ve taslaklarda da aynı çıkar (`1=PP07 … 16=NP05`).
   - Vaka üreticisi olarak bu kimlikleri taslak aşamasında gördüm.
   - Örneklemdeki iki vaka, NP05 ve PP07, bundan **sonra** 4. maddedeki set geneli ölçütlerle değiştirildi.
     PP07 düzeltmesi örneklemde olmayan NP14'e de aynı biçimde uygulandı.
   - Kör okuyucunun bunu bilerek değerlendirmesi için buraya yazıldı.
6. **Etiket politikası** H19b/H19d ile aynı: fonksiyon düzeyi. Tetikleyiciler kendi gövdeleriyle etiketlenir.
7. **Bilinçli zor negatifler:** kilit veya sürüm kelimeli bağlamda D5 dışı değişiklikler.
   - Fiyat politikası sürümü anlık görüntüsü: NS09, NS12.
   - Plan politikası sürümü: NS10.
   - `expectedVersion` içeren tekrar özetleri: NS05–NS07, NP10.
   - Kilit altındaki yetki/limit kontrolleri: NS01, NS02, NS15.
   - Kilit sırası dosyasındaki grup doğrulaması: NS13, NS14, NS17, NP12, NP19, NP20.
   - Bu vakalar kör okuyucuda uyuşmazlık çıkarırsa protokole göre düşer.
