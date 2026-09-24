# H19b′: vaka seti ve çalıştırma düzeni

- **Protokol:** [`../H19B-PRIME-PROTOKOL.md`](../H19B-PRIME-PROTOKOL.md), sürüm v0.1, mühürlü (5bc1aed; H19 sahibi).
- **Vaka üreticisi:** Claude.
- **Kör ikinci okuyucu:** H19 sahibi.

**Durum:** Vakalar donduruldu. **Hiçbir H19b′ Jev çağrısı yapılmadı.** Kör ikinci okuyucu kontrolü ölçümden önce tamamlandı: 16/16 D5 etiketi ve no_effect ekseni anahtarla uyuştu, 0 vaka düştü. Etiketler `55e0e4c795edca20602fbf7f21c786a6c21a9231` commitinde mühürlü; ölçüm kapısı açıktır.

```text
vakalar.v0.1.json sha256 2ca2e3fce5daa98817424e7903fb4431a4eae586df615589580f8b247d496c41
```

| Dosya | İş |
|---|---|
| `vakalar.mjs` | 64 vaka tanımı: gerçek migration fonksiyonu (gerekirse eski sürümü), mutasyon, etiket, yön, eksen, aile, gerekçe |
| `kur.mjs` | Kurar ve protokol §2–§3'ü doğrular (matris, eşleştirme, olgular, ipucu, H19b tekrarı, naif özellik kapısı); ardından dondurur |
| `vakalar.v0.1.json` | **Donmuş set** |
| `vakalar.md` | Okunur liste (olgular dahil) |
| `ikinci-okuyucu.md` | **Kör kontrol, 16 vaka.** Hücre, etiket ve olgu yok |
| `ikinci-okuyucu-anahtar.md` | Anahtar. Cevaplardan sonra açılmalı |
| `taban.mjs` | Jev'siz naif özellikler |
| `calistir.mjs` | JF1, JF2, J0, V kolları: 64 × 4 = 256 çağrı. **Çalıştırılmadı** |
| `analiz.mjs` | P1–P6 ve §10 ikincilleri; eşleştirilmiş bootstrap (10 000 tekrar, sabit tohum). Ölçümden önce yazıldı; yalnız sahte veriyle sınandı |

Olgular H19b v0.2'nin donmuş extractor'ından gelir (`../h19b/extractor.mjs`).

## Kör kontrolden sonra

1. `ikinci-okuyucu.md` doldurulup commit'lenir.
2. Uyuşmazlık çıkan vakalar `dusen.json` dosyasına yazılır (ör. `["AP03"]`). Vaka yeniden etiketlenmez; analiz
   onu ve eşini düşürür.
3. `H19BP_CASES_SHA256=<yukarıdaki> NODE_USE_ENV_PROXY=1 node h19/h19b-prime/calistir.mjs`
4. `node h19/h19b-prime/analiz.mjs h19/h19b-prime/sonuc/<ts>`

## Matris (doğrulandı)

| Hücre | Vaka | Yön / eksen | Eşsiz |
|---|---|---|---|
| A′ (kilitli, gerçek D5) | 16 | 8 weakens, 8 strengthens | 0 |
| B′ (kilitsiz, ipucusuz, gerçek D5) | 16 | 8 weakens, 8 strengthens | 0 |
| C′ (kilitli, D5 değil) | 16 | D0, D2, D3, D4 × 4 | 0 |
| D′ (kilitsiz, D5 değil) | 16 | D0, D2, D3, D4 × 4 | 0 |

- **Eşler:** A′–C′ çiftleri aynı fonksiyon tanımını paylaşır, B′–D′ çiftleri de öyle (16 + 16).
- **Doğrulananlar:**
  - Tüm vakalarda `guard_delta = unchanged`.
  - B′ ve D′'de `lock_context = false`; yol ve diff'te ipucu sözlüğü yok; gövdede `FOR SHARE` yok.
  - Hiçbir mutasyon H19b'den tekrar değil.

## Naif özellik kapısı (protokol §2)

Kapı: hiçbir tek özellik B′–C′'de AUC > 0.70 vermemeli. İlk üç kurulum bu kapıya takıldı. Set, hiçbir model
çağrısı yapılmadan yeniden dengelendi:

1. **İlk durum:** C′ diff'leri küçüktü, B′'ninkiler büyüktü. Diff boyutu 0.78, silinen satır 0.84 verdi.
2. **Düzeltmeler:**
   - C′ vakaları, yine yalnız başka ekseni değiştiren gerçekçi yeniden yazımlarla büyütüldü. Ör. kendi
     profilini düzenleme yetkisi (D0), fiyat politikası bloğu (D2), plana bağlı limit (D3), aynı gün iptal
     yasağı (D4).
   - B′ güçlendirmeleri daha gerçekçi ve küçük biçime getirildi. Ör. yalnız yarışa açık ekleme dalı
     çözümleyiciye devrediliyor, hızlı arama korunuyor.
   - Birkaç D′ vakası da büyütüldü.
3. **Etiketler ve eksenler değişmedi.**

Donmuş sette:

| Naif özellik | genel | A′–C′ | B′–D′ | **B′–C′** |
|---|---|---|---|---|
| diff boyutu (değişen satır) | 0.51 | 0.30 | 0.71 | **0.47** |
| eklenen satır | 0.54 | 0.31 | 0.73 | **0.46** |
| silinen satır | 0.58 | 0.52 | 0.66 | **0.68** |
| silinen and/where oranı | 0.48 | 0.53 | 0.42 | **0.56** |
| eklenen exists/select | 0.44 | 0.33 | 0.56 | **0.41** |
| eklenen raise | 0.53 | 0.56 | 0.50 | **0.47** |
| yalnız olgular (lock_context + inside) | 0.53 | 0.63 | 0.50 | **0.00** |

**Okuma:**
- **Yalnız olgular B′–C′'de 0.00.** Beklenen ve tasarımın kendisi: olgu B′'de "kilit yok", C′'de "kilit var"
  diyor, yani olgu kısayolu yanlış yöne itiyor.
- **B′–D′'de boyut 0.71.** P3 eşiği (0.75) boyutla tek başına geçilemez. Kapı kapsamı dışında olduğu için
  kayıt altına alındı.
- **A′–C′'de boyut 0.30.** C′ diff'leri daha büyük. Bu, "büyük değişiklik = risk" okuyan bir modelin aleyhine,
  yani testi zorlaştırır.

## Kurulum notları (ölçümden önce yazıldı)

1. **Gerçek sürümler.** Bazı vakalar fonksiyonun eski bir migration sürümüne uygulandı. Ör. `update_staff_guarded`,
   `update_service_guarded`, `set_staff_service_guarded` ve saat fonksiyonlarının 111500/111600 sürümleri;
   `consume_public_booking_rate`'in phase9 sürümü; eski medya fonksiyonları.
   - Sebep: güncel kod zaten sertleştirilmiş. Gerçekçi "strengthens" malzemesi, sonradan onarılan eski
     sürümlerde var.
   - Ör. AP02, AP04, AP10: s04/f10 stale-hardening onarımı. BP02: gerçek s04 pencere onarımı.
2. **Aile yoğunluğu.** A′ strengthens'in 6/8'i, A′ weakens'in 2/8'i `stale_token` ailesinden. Bunun sebebi
   gerçek sertleştirme migration'ının böyle olması. Aile bazında hata oranı analizde ayrıca raporlanır;
   yön, boolean mantığın tam okunmasına bağlıdır.
3. **`share_fence`.** AP15 ve AP16 okumaya `FOR SHARE` ekler. Donmuş kilit tanımı `FOR SHARE`'i saymadığı için
   `guard_delta = unchanged` kalır. Güçlendirme gerçektir: personel satırını `FOR UPDATE` ile kilitleyen
   pasifleştirme/atama işlemleriyle serileşir. Bu aile yalnız A′'de ve en fazla 2 vakada kullanıldı; B′'de
   hiç kullanılmadı.
4. **Etiket politikası fonksiyon düzeyinde (H19b ile aynı).** BP11, BP14, BP15, BP16'da seri hale getiren
   yardımcının (`f10_resolve_or_create_customer`, işletme anahtarlı advisory kilit) koruması sayılır. Bu
   yardımcının adı diff'te görünür; gövdesi görünmez.
5. **Kaldırılan aday.** `update_public_booking_settings` üzerinde bir B′ weakens vakası denendi ve çıkarıldı.
   İşletme oluşturulurken tetikleyici ayar satırını hep yarattığı için "güncelle, yoksa ekle" yarışı pratikte
   oluşmuyor; etiket belirsizdi.
6. **İstatistiksel güç.** 16 + 16 ile AUC farkının bootstrap %95 aralığı kabaca ±0.27 genişliğinde (sahte veride
   görüldü). P1'in alt sınır koşulu için gerçek JF–V farkının yaklaşık 0.25 veya üstü olması gerekir.
