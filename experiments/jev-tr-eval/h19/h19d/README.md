# H19d: vaka seti ve çalıştırma düzeni

- **Protokol:** [`../H19D-PROTOKOL.md`](../H19D-PROTOKOL.md), sürüm v0.1, mühürlü (6992921; H19 sahibi).
- **Vaka üreticisi:** Claude.
- **Kör ikinci okuyucu:** H19 sahibi.

**Durum:** Vakalar donduruldu. **Hiçbir H19d Jev çağrısı yapılmadı.** Kör ikinci okuyucu kontrolü ölçümden önce tamamlandı: 16/16 D5 etiketi ve diğer eksenler anahtarla uyuştu, 0 vaka düştü. Etiketler `dda21c05fb05848aaee7b7b9e10b5dbb4e9fa3a4` commitinde mühürlü; ölçüm kapısı açıktır.

```text
vakalar.v0.1.json sha256 90139d3f4848d73d9ce0635a3da14e5f625504e712e3010c29bf10f8be01f501
```

| Dosya | İş |
|---|---|
| `vakalar.mjs` | 80 vaka tanımı: gerçek migration fonksiyonu, mutasyon, etiket, eksen(ler), yön (yalnız kayıt), aile, gerekçe |
| `kur.mjs` | Kurar ve protokol §4–§7'yi doğrular (matris, tekrar yasağı, denge, aile payı, naif özellik kapısı); bütün kapılar geçerse dondurur |
| `vakalar.v0.1.json` | **Donmuş set.** Betimleyici alanlar yalnız denge içindir; Jev'e verilmez |
| `vakalar.md` | Okunur liste |
| `ikinci-okuyucu.md` | **Kör kontrol, 16 vaka**: 4 PS, 4 PP (farklı eş eksenler), 4 NS, 4 NP. Katman ve etiket yok |
| `ikinci-okuyucu-anahtar.md` | Anahtar. Cevaplardan sonra açılmalı |
| `calistir.mjs` | V1 ve V2: 80 × 2 = 160 çağrı. Altı eksen sorusu aynen; facts yok, yön yok. **Çalıştırılmadı** |
| `analiz.mjs` | S0 (birincil) ve S1 (ikincil) için D1–D4; baseline üstünlük kuralı; Wilson aralıkları; §12 katmanları; sonuç ağacı. V1'den önce yazıldı; yalnız sahte veriyle sınandı |

## Kör kontrolden sonra

1. `ikinci-okuyucu.md` doldurulup commit'lenir.
2. Uyuşmazlık çıkan vakalar `dusen.json` dosyasına yazılır (ör. `["PS03"]`). Vaka yeniden etiketlenmez;
   yenisiyle doldurulmaz.
3. `H19D_CASES_SHA256=<yukarıdaki> NODE_USE_ENV_PROXY=1 node h19/h19d/calistir.mjs`
4. `node h19/h19d/analiz.mjs h19/h19d/sonuc/<ts>`

## Matris (doğrulandı)

| Katman | Vaka | Dağılım |
|---|---|---|
| PS: D5 tek eksen | 20 | 10 weakens, 10 strengthens |
| PP: D5 + başka eksen | 20 | D5×D0, D1, D2, D3, D4 dörder |
| NS: D5 yok, tek eksen | 20 | D0–D4 dörder |
| NP: D5 yok, iki eksen | 20 | 10 çiftin her biri ikişer |

**PP yön dağılımı:** D0 2+2, D2 2+2, D3 2+2, D4 2+2. **D1×D5 4 weakens + 0 strengthens.**
- Protokol "mümkünse 2 + 2" diyor.
- Kilitsiz ve temiz bir "tekrar + eşzamanlılık güçlendirmesi" bulamadım. Adaylar ya gereksizdi (claim
  zaten atomik) ya da yalnız D1'di.
- Bu sapma ölçümden önce kaydedildi. Yön bu deneyin etiketi değil.

## Denge ve naif özellik kapısı (protokol §6–§7)

| | Pozitif | Negatif | Kural |
|---|---|---|---|
| `lock_context = true` | 19 | 23 | fark ≤ 4 ✓ |
| Diff'te (yol dahil) H19a ipucu sözlüğü | 23 | 19 | fark ≤ 4 ✓ |

- İlk kurulumda ipucu dengesi 24'e 9'du ve set donmadı.
- **Neden:** D5 değişiklikleri doğal olarak kilit/sürüm kelimeleri taşıyor.
- **Düzeltme:** Hiçbir model çağrısı yapmadan bazı negatifler kilit veya sürüm satırlarının yanına taşındı.
  Değişiklik yine yalnız başka eksen. Ör.:
  - kilitli okumanın kaynak türü politikası (NS10);
  - kilit altındaki sayımın aktif filtresi (NS13, NP15);
  - adında "lock" geçen dosyadaki grup yeniden planlama kuralları (NS03, NS20, NP13).
- Kilit içermeyen fonksiyonlardaki ipucusuz negatiflerin bir kısmı kilitsiz fonksiyonlara taşındı; böylece
  iki denge birlikte sağlandı.

| Naif özellik | genel AUC | PP–NP AUC |
|---|---|---|
| diff boyutu | 0.52 | 0.55 |
| eklenen satır | 0.64 | 0.67 |
| silinen satır | 0.46 | 0.50 |
| silinen where/and | 0.63 | 0.61 |
| ipucu var | 0.55 | 0.57 |
| lock_context | 0.45 | 0.47 |
| removed-predicate var | 0.65 | 0.63 |

Hepsi ≤ 0.70. Tek bir fonksiyon ailesi hiçbir katmanda %50'yi geçmiyor. En yüksek pay 6/20 (PS'de booking).

## Kurulum notları (ölçümden önce yazıldı)

1. **Tekrar yasağı.** R0/H19a, H19b ve H19b′ mutasyonları otomatik kontrol edildi:
   - H19b ve H19b′ için fonksiyon + bul + değiştir üçlüsüne bakıldı;
   - R0 için değişen satır kümesi R0 girdileriyle karşılaştırıldı.

   80 vakanın 65'i daha önce kullanılmış bir fonksiyon tanımını yeni bir mutasyonla kullanıyor
   (`function_reused`).
2. **Kendi düzelttiğim etiket.** PS10 ilk sürümde `complete_notification_job_v2`'nin istek parmak izi
   koşulunu kaldırıyordu.
   - Makbuz belirteci de istek başına sabit olduğu için bu koşul büyük olasılıkla gereksiz; gerçek etki
     `no_effect` olabilirdi.
   - Dondurmadan önce net bir zayıflatmayla değiştirildi: randevu silinince sayfa revizyonu artık
     yenilenmiyor. Bu iyimser revizyon belirteci.
3. **Bilinçli zor negatifler:** kilitli veya ipucu kelimeli bağlamda D5 dışı değişiklikler (NP01, NS10, NS12,
   NS13, NP15, NP17, NP19).
   - NP01 kilitli okumadan aktör filtresini kaldırıyor (D0 + D1). Kilit kapsamı genişliyor ama güvence
     zayıflamıyor.
   - Bu vakalar kör okuyucuda uyuşmazlık çıkarırsa protokole göre düşer.
4. **Etiket politikası** H19b ile aynı: fonksiyon düzeyi.
5. **Paylaşımlı kilit (`FOR SHARE`) güçlendirmeleri** (PS16, PS18–20, PP11, PP12) gerçek çitlerdir. Bu sette
   `lock_context` betimleyicisi yalnız denge içindir; Jev'e verilmez.
