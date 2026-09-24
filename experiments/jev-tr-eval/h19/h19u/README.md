# H19u: vaka seti ve çalıştırma düzeni

- **Protokol:** [`../H19U-PROTOKOL.md`](../H19U-PROTOKOL.md), sürüm v0.1, mühürlü (d39e388; H19 sahibi).
- **Vaka üreticisi:** Claude.
- **Kör ikinci okuyucu:** H19 sahibi.

**Durum:** Vakalar donduruldu. **Hiçbir H19u Jev çağrısı yapılmadı.** Kör ikinci okuyucu kontrolü ölçümden önce tamamlandı: 14/16 uyum. İki uyuşmazlık: A16 (kör `BOTH`, anahtar `D1_ONLY`) ve C20 (kör `D5_ONLY`, anahtar `BOTH`). İlk sayımda 15/16 yazılmıştı; C20 uyuşmazlığı ilk Jev çağrısından önce, kör etiket commit'i ile anahtar karşılaştırılırken fark edildi. Protokol §4 gereği ikisi de yeniden etiketlenmedi, `dusen.json` ile düşürüldü ve yerine vaka konmadı. Çağrılar 80 vakada yapılır; U1–U5 analizi 78 vaka üzerindedir. Kör etiketler `1afdf35483b4d3c43c217c54de73a20f329158c5` commitinde mühürlü. Ölçüm kapısı açıktır.

```text
vakalar.v0.1.json sha256 ba531c863b5ff27b382008dfd55d4f5d8f898c62b15bc8c9d6c652301a859914
```

| Dosya | İş |
|---|---|
| `vakalar.mjs` | 80 vaka tanımı: gerçek migration fonksiyonu, mutasyon, katman/etiket, aile, yön (yalnız kayıt), gerekçe |
| `kur.mjs` | Kurar ve protokol §2–§3'ü doğrular (matris, tekrar yasağı, katmanlar arası ipucu/kilit dengesi, aile payı, üç karşılaştırmalı naif özellik kapısı); bütün kapılar geçerse dondurur |
| `vakalar.v0.1.json` | **Donmuş set.** Betimleyici alanlar yalnız denge içindir; Jev'e verilmez |
| `vakalar.md` | Okunur liste |
| `ikinci-okuyucu.md` | **Kör kontrol, 16 vaka**, katman başına 4. Katman ve etiket yok |
| `ikinci-okuyucu-anahtar.md` | Anahtar. Cevaplardan sonra açılmalı |
| `calistir.mjs` | V1 (altı eksen) + R1, R2 (§1 Aşama 2 ayrıştırıcı Choice): 80 × 3 = 240 çağrı. **Çalıştırılmadı** |
| `analiz.mjs` | U1–U5 (§6–§10), §11 ikincil raporlar, §12 sonuç kuralı. V1'den önce yazıldı; yalnız sahte veriyle sınandı |

## Kör kontrolden sonra

1. `ikinci-okuyucu.md` doldurulup commit'lenir.
2. Uyuşmazlık çıkan vakalar `dusen.json` dosyasına yazılır (ör. `["A03"]`). Vaka yeniden etiketlenmez;
   yenisiyle doldurulmaz.
3. `H19U_CASES_SHA256=<yukarıdaki> NODE_USE_ENV_PROXY=1 node h19/h19u/calistir.mjs`
4. `node h19/h19u/analiz.mjs h19/h19u/sonuc/<ts>`

## Matris (doğrulandı)

| Katman | Vaka | Dağılım |
|---|---|---|
| A: D1_ONLY | 20 | 16 receipt/request-hash/replay ailesi (en az 8 gerekiyordu) + 4 başka D1 ailesi |
| B: D5_ONLY | 20 | 10 weakens + 10 strengthens |
| C: BOTH | 20 | 5 mekanizma ailesi (en az 4 gerekiyordu); yön kaydı: hepsi weakens |
| D: NEITHER_OR_OTHER | 20 | D0, D2, D3, D4 beşer |

**A'nın ailesi:**
- **Receipt/request-hash/replay ailesi:**
  - komut kimliği;
  - makbuzun kapatılmaması;
  - tekrarın atlanması;
  - makbuza eski sonucun yazılması;
  - istek özetinden alan çıkarma;
  - özet çakışmasının gevşemesi;
  - meşru tekrarın çakışmaya dönmesi;
  - sonuç bağlama kontrolü.
- **Diğer D1 aileleri:**
  - aynı duruma ikinci geçişin etkisiz sayılmaması (A16);
  - sağlayıcı tekilleştirme anahtarının kimliği (A17);
  - yeniden bağlamanın tekrarı (A18);
  - talebin hep-ya-hiç alt işlemden çıkması (A19).

**C'nin mekanizmaları:**
- **Bileşik (13):** aynı fonksiyonda bağımsız bir D5 değişikliği ve bir D1 değişikliği. Dokuzunda D1 parçası
  "kayıtlı sonucun döndürülmemesi".
- **Komut anahtarı kilidinin kaldırılması (2):** C04, C05.
- **Tekrar yoklamasının kilitsiz kalması (2):** C13, C14.
- **Sarmalayıcı yoklama kilidinin kaldırılması (1):** C02.
- **"Varsa getir, yoksa oluştur" kilidinin kaldırılması (1):** C20.

## Denge ve naif özellik kapısı (protokol §3)

İpucu sözlüğü protokoldeki gibi `/for update|lock|version|advisory|serializ|idempoten|request_hash|receipt|replay/i`.
H19t'de olduğu gibi yol dahil diff metninde aranır.

| | A | B | C | D | En büyük fark | Kural |
|---|---|---|---|---|---|---|
| İpucu var | %80 | %85 | %100 | %85 | 20 puan | ≤ 25 ✓ |
| `lock_context` | %80 | %80 | %95 | %90 | 15 puan | ≤ 25 ✓ |

| Naif özellik | A–C | B–C | (B+C)–(A+D) |
|---|---|---|---|
| diff boyutu | 0.47 | 0.49 | 0.64 |
| eklenen satır | 0.51 | 0.34 | 0.56 |
| silinen satır | 0.54 | 0.64 | 0.61 |
| silinen where/and | 0.53 | 0.42 | 0.53 |
| eklenen exists/select | 0.50 | 0.50 | 0.50 |
| ipucu var | 0.60 | 0.57 | 0.55 |
| lock_context | 0.57 | 0.57 | 0.51 |
| removed-predicate var | 0.53 | 0.42 | 0.53 |

- Protokol her tek özellik için AUC ≤ 0.70 istiyor. Bu karşılaştırmalarda "pozitif" sınıf keyfi olduğu için
  kapı iki yönde birden uygulandı: AUC ∈ [0.30, 0.70].
- Tek bir fonksiyon ailesi hiçbir katmanda %50'yi geçmiyor.

## Kurulum notları (ölçümden önce yazıldı)

1. **Tekrar yasağı.** H19t'deki kontroller H19t'yi de kapsayacak biçimde genişletildi:
   - H19b, H19b′, H19d ve H19t için fonksiyon + bul + değiştir üçlüsü;
   - R0/H19a, H19b, H19b′, H19d ve H19t donmuş girdilerinin hepsinde değişen satır kümesi;
   - set içi tekrar.

   80 vakanın 66'sı daha önce kullanılmış bir fonksiyonu yeni bir mutasyonla kullanıyor (`function_reused`).
   D1 malzemesi büyük ölçüde fiş/ödeme/ürün/gider komut fonksiyonlarındaki makbuz ve tekrar yollarından geliyor.
2. **Dondurmadan önce yapılan düzeltmeler (hiçbir model çağrısı yapmadan):**
   - **Etiket düzeltmesi, en önemlisi.** İlk C06–C08, makbuz talebindeki `ON CONFLICT DO NOTHING`'i
     `DO UPDATE`'e çeviriyordu. Bunlar yalnız D1'dir: eşzamanlı ikinci istek, ilk isteğin eklediği satırı zaten
     bekliyor; eşzamanlılık davranışı değişmiyor. BOTH olarak etiketlenemezlerdi; gerçek BOTH vakalarıyla
     değiştirildi.
   - **Etiket düzeltmesi.** İlk A15 (yönetim belirteci karşılaştırması) aynı fonksiyonda sonradan yapılan bir
     kontrolle zaten yakalanıyordu, yani etkisi belirsizdi. Meşru tekrarın çakışmaya dönmesiyle değiştirildi.
   - **Etiket düzeltmesi.** İlk D20 (slot adımı) D3 olarak da okunabilirdi. Yerel gün dönüşümüyle değiştirildi.
   - **Tekrar:** A07–A03, C03/C09–C01 aynı değişen satır kümesini üretiyordu. B13 ve B14 ise H19t PS16/PS18
     ile aynıydı. Hepsi farklılaştırıldı.
   - **Boyut kapısı:** C'deki büyük taşımalar (kontrolü kilitten önceye alma, 17 satır; talebi
     kontrol-sonra-ekle, 19 satır) naif boyut özelliğini 0.82'ye çıkarıyordu. Kompakt mekanizmalarla
     değiştirildi. Bazı B vakaları iki düzenlemeli yapıldı (B02, B03, B08, B15).
3. **Kör örneklem.** Tohum, donmuş dosyanın SHA-256 özetinin ilk 8 hanesi (`ba531c86`). Böylece örneklem
   dondurmadan önce bilinemiyordu (H19t'deki şeffaflık notunun dersi).
   - `okuyucu.mjs` yalnız donmuş set üzerinde bir kez çalıştırıldı.
   - Örneklemi gördükten sonra hiçbir vaka değiştirilmedi.
   - Örneklem: A04, A08, A16, A17 · B02, B08, B16, B17 · C04, C12, C13, C20 · D01, D10, D11, D19.
4. **Ayrıştırıcı sorusu** protokol §1'deki metnin aynısıdır; satır sonları boşlukla birleştirildi. Her satırda
   soru özeti (`question_sha256`) kaydedilir. Aşama 2 yalnız `{ files }` görür: V skoru, bayrak ya da facts
   verilmez.
5. **Etiket politikası** H19b–H19t ile aynı: fonksiyon düzeyi.
6. **Etiketi en tartışmaya açık vakalar** (önceden, dürüstlük için):
   - **D1 etkisi yalnız yarış altında ortaya çıkan tek mekanizmalı C vakaları:** C02, C04, C05, C13, C14,
     C20. En zayıfı C04: yeni bir anahtar için tekrar yoklamasının kilitsiz kalması.
   - **A16:** aynı duruma ikinci geçiş.
   - **D09:** abonelik olayındaki yetki listesi.
   - Bu vakalar kör okuyucuda uyuşmazlık çıkarırsa protokole göre düşer.
