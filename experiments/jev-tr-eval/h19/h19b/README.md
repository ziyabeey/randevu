# H19b: vaka seti ve çalıştırma düzeni

Protokol: [`../H19B-PROTOKOL.md`](../H19B-PROTOKOL.md), sürüm v0.2, mühürlü (e3f1882).

**Durum: vakalar donduruldu. Hiçbir Jev çağrısı yapılmadı.** Ölçüm, ikinci okuyucu kontrolünden sonra
yapılacak.

| Dosya | İş |
|---|---|
| `extractor.mjs` | S5 olguları (betimleyici). Testleri: `node --test h19/h19b/extractor.test.mjs` |
| `vakalar.mjs` | 50 vaka tanımı: gerçek migration fonksiyonu, mutasyon, etiket, gerekçe |
| `kur.mjs` | Vakaları kurar, doğrular, `vakalar.v0.1.json` dosyasına dondurur |
| `vakalar.v0.1.json` | **Donmuş set.** SHA-256 aşağıda |
| `vakalar.md` | Okunur liste |
| `ikinci-okuyucu.md` / `-anahtar.md` | Kör kontrol: 12 vaka (hücre başına 3, sabit tohum), anahtar ayrı dosyada |
| `taban.mjs` | Jev'siz naif tabanlar |
| `calistir.mjs` | J1, J2, V, JI, VI, JF kolları (230 çağrı). **Henüz çalıştırılmadı** |
| `analiz.mjs` | Kapılar ve ikincil ölçütler. Ölçümden önce yazıldı; sahte veriyle yalnız çalıştığı sınandı |

```text
vakalar.v0.1.json sha256 3faa879057aed906eb8b69fe673a64a066228a4db170a3866315610d5e9d70f6
```

Çalıştırma, ikinci okuyucudan sonra:
`H19B_CASES_SHA256=<yukarıdaki> NODE_USE_ENV_PROXY=1 node h19/h19b/calistir.mjs`, ardından
`node h19/h19b/analiz.mjs h19/h19b/sonuc/<ts>`.

## Kurulum notları (ölçümden önce yazıldı)

Bunlar protokolü değiştirmez; protokolün açık bıraktığı yerlerde nasıl uygulandığını kaydeder.

1. **Etiket politikası: fonksiyon düzeyi.** Soru "bu fonksiyonda" korumayı sorar.
   - Çağıranların tuttuğu kilitler sayılmaz. Ör. B01, B02 ve B09'daki bitirme fonksiyonları gerçekte
     kilit tutan bir claim sonrasında çağrılıyor.
   - Fonksiyonun kendi çağırdığı yardımcının koruması sayılır. Ör. B10'da kilitli müşteri çözümleyici
     çağrısı kaldırılıyor.
2. **İpucu denetiminin kapsamı:** `files[].path` ve `files[].patch`.
   - Protokol "Jev girdisinin hiçbir yerinde" diyor. Ama olgu alan adları (`lock_context`,
     `changed_inside_locked_region`) sabit ve her hücrede aynı; zorunlu olarak "lock" kelimesini içeriyor.
   - Bu yüzden denetim diff malzemesine uygulanır.
   - Ek olarak B/D gövdelerinde `FOR SHARE` da yok. Bu, protokolün kilit tanımından daha katı bir seçim
     kuralıdır.
3. **A hücresinde `changed_inside_locked_region` false olabilir.** Protokol bunu yalnız C için tanımlıyor.
   - A08'de değişen satır, kilit ifadesinin kendi WHERE satırı.
   - A09'da eklenen yol kilidin önünde.
   - Extractor olduğu gibi raporlar; kurala uydurulmadı.
4. **`guard_delta` sayıma dayanır:** kilit yapısı ve WHERE sürüm koşulu sayısı. Aynı değişiklikte hem
   kaldırma hem ekleme tanımsızdır; extractor bu durumda hata verir.
5. **E katmanında 2 vakada kod kuralı bilerek yanlış:**
   - E05: sürüm koşulu kaldırıldı ama aynı fonksiyonda gereksizdi.
   - E09: sürüm koşulu eklendi ama gereksiz.

   Etiketler gerçeği yansıtır (`no_effect`). Bu vakalar H19c'nin "Jev kod kuralına ne katar" sorusu için
   veri üretir.
6. **Boyut dengelemesi (dondurmadan önce).** İlk sürümde tüm C/D vakaları 1–3 satırdı.
   - Yalnız diff boyutuyla AUC B–D için 0.84 çıkıyordu: model anlamı okumadan "büyük değişiklik →
     weakens" ile geçebilirdi.
   - Beş C ve beş D vakası, korumaya dokunmayan çok satırlı değişikliklerle değiştirildi.
   - D09 silinen koşul satırı olan bir negatif oldu.

   Donmuş setteki tabanlar:

   | Jev'siz naif taban | AUC | A–C | B–D |
   |---|---|---|---|
   | diff boyutu (değişen satır) | 0.57 | 0.54 | 0.59 |
   | silinen `and`/`where` satırı | 0.71 | 0.70 | 0.76 |
   | eklenen `exists`/`select` | 0.56 | 0.45 | 0.68 |
   | eklenen `raise` sayısı (az → weakens) | 0.72 | 0.71 | 0.73 |

   Protokol kapısı mutlak (AUC ≥ 0.80). Jev'in sonucu bu tabanlarla birlikte okunmalı. Özellikle "silinen
   koşul satırı" kısmen gerçek anlam taşıyor: koruma koşulunu silmek çoğu zaman zayıflatmanın kendisi.
7. **Eşleştirilmiş çiftler:**
   - A01–A10 ile C01–C10 aynı fonksiyonlarda; aynı kilit bağlamında biri güvenceyi deliyor, diğeri
     yalnız iş mantığını değiştiriyor.
   - B09 ile D10 da aynı fonksiyonda.
