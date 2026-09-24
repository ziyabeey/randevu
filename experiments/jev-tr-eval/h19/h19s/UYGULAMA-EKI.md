# H19s uygulama eki (TASLAK, mühürsüz)

- **Protokol:** [`../H19S-PROTOKOL.md`](../H19S-PROTOKOL.md) v0.1 (c9b6fca, 2026-09-24T12:13:53Z).
- **Durum:** Bu ek bir **öneridir**. §3'teki açık kararlar H19 sahibi tarafından verilip ek mühürlenmeden ilk
  uygun birim ölçülmez.
  - İlk uygun birim, protokol commit'inden sonra main'e merge edilen ve bir rutin gövdesini değiştiren ilk PR'dır.
  - Bu ek yazılırken protokolden sonra main'e hiçbir PR merge edilmemişti.
- **H19s Jev çağrısı yapılmadı.**

Protokol birim tanımını, "System Two maliyeti"nin birimini ve etiketleyicileri yöntem düzeyinde bırakıyor.
Bu ek, deterministik uygulamanın o boşlukları nasıl kapattığını yazar.

## 1. Birim çıkarımı: `cikar.mjs` (uygulandı)

**PR.** `main`'in ilk ebeveyn hattında, protokol commit zamanından sonra gelen merge commit'i. PR numarası şu
mesajlardan okunur:
- merge commit'i: `Merge pull request #N from …`;
- squash merge: başlık sonunda `(#N)`.

**Final fark.** `merge^1 → merge`. Aynı PR'ın ara head'leri okunmaz.

**Dosya.** Final farkta eklenen, değişen ya da yeniden adlandırılan `supabase/migrations/**/*.sql`.

**Rutin kimliği.** `şema.ad/argüman sayısı`. Şema yazılmamışsa `public` kabul edilir; ad küçük harfe çevrilir.

**Geçerli tanım.** Migration'lar dosya adı sırasıyla uygulanır:
- aynı kimliğin son tanımı geçerlidir;
- sonradan gelen bir `drop function` tanımı siler.

**Birim.** Bir rutin şu koşulların hepsini sağlıyorsa birimdir:
- değişen dosyalardan birinde tanımlanmıştır;
- merge ağacındaki geçerli tanımı değişen bir dosyadadır;
- yorum ve boşluk atılmış gövdesi, base ağacındaki geçerli tanımdan farklıdır. Base'de tanım yoksa rutin
  `new` olarak işaretlenir (bkz. §3a).

**Dışarıda kalanlar** (kayıtta sayılır):
- yalnız başlığı değişip gövdesi aynı kalan rutin;
- düşürülen ya da sonraki bir dosyada yeniden tanımlanan rutin;
- tablo, index, grant ve trigger DDL'i (rutin değildir).

**Jev girdisi.**
- `files: [{ path: <yeni tanımın migration yolu>, patch }]`.
- `patch`, base'deki geçerli `create … function` ifadesinden merge'deki geçerli ifadeye `-U3` birleşik farktır.
- `new` rutinde bu fark yalnız eklenen satırlardan oluşur.
- H19u'daki girdi biçimiyle aynıdır: yol + hunk.

**Sıra.** Merge sırası; aynı PR içinde rutin kimliği sırası. S5'teki iki yarı bu sıraya göre ayrılır.

**Stop rule sayımı.** "25 ayrı merged PR", en az bir birimi olan PR sayısıdır. Birimsiz PR'lar kayıtta
tutulur ama sayılmaz.

## 2. Kalibrasyon (protokolden önceki trafik; örnekleme dahil değil, Jev çağrısı yok)

Klon sığ olduğu için elde yalnız 2026-09-23T06:02'den protokole kadar olan `main` geçmişi vardı. Bu yaklaşık
28 saatte 55 PR merge edildi; yalnız 6'sında birim çıktı.

| PR | Birim | `new` | `modified` |
|---|---|---|---|
| #333 | 1 | 1 | 0 |
| #363 | 17 | 17 | 0 |
| #385 | 10 | 10 | 0 |
| #394 | 12 | 6 | 6 |
| #452 | 1 | 1 | 0 |
| #475 | 13 | 12 | 1 |
| **Toplam** | **54** | **47 (%87)** | **7 (%13)** |

- Ayrıştırma hatası çıkmadı.
- Hiçbir `new` rutin, base'de başka argüman sayısıyla var olan bir adın imza değişikliği değil.
- `new` farkların boyu 6–251 eklenen satır.

## 3. Sahibin vermesi gereken kararlar

### a. Yeni rutinler birim mi?

Protokol "gövdesi değişen" diyor. Yeni bir rutinin öncesi yok.

| Seçenek | Sonuç |
|---|---|
| **Dahil** | Örneklem büyük ölçüde (kalibrasyonda %87) tamamen yeni fonksiyonlardan oluşur. H19u yalnız mevcut fonksiyonlardaki değişikliği sınadı; tamamen eklenen girdi dağılım dışıdır. 150 birim / 25 PR tahminen birkaç günde dolar. |
| **Hariç** | H19u ile aynı türde girdi. Ama kalibrasyon hızıyla 150 birim yaklaşık bir ay sürer; birimli PR sayısı da yavaş artar (6 PR'ın 2'si). |
| **Dahil, ama gate'ler `modified` için ayrıca** | Bu protokolde yok; yeni bir gate eklemek olur. Önermiyorum. |

**Öneri:** Protokolün yazıldığı biçimde (gerçek trafik) dahil. `new` / `modified` kırılımı yalnız ikincil rapor
olur (§12, gate değil).

### b. "System Two maliyeti" hangi birimle ölçülür?

Mevcut review PR başına çalışıyor. Protokol ise birim başına baseline ve aday maliyeti istiyor (§6).

**Öneri:** Her birim, H19'dan kör bir System Two birim okumasıyla bir kez okunur:
- aynı sabit istem ve aynı model kullanılır;
- girdi birimin `files` alanıdır.

Bu okumanın gerçek token sayısı, dondurulmuş fiyatla birimin System Two maliyetidir:
- baseline = bütün birimlerin toplamı;
- aday = yalnız route edilen birimlerin toplamı + V + resolver.

Bu okuma §5'teki 1. referans okuyucu ile aynı çağrı olabilir.

### c. Referans etiketleyiciler (§5)

**Öneri:** İki bağımsız System Two okuyucu.
- Her biri yalnız birim paketini görür: `files` + PR başlığı. H19 çıktısı görmez.
- Çıktı: D1 ve D5 için yes/no/undetermined, `actionable_D5`, kısa gerekçe.
- Okuyucular iki ayrı model/oturum olabilir.
- D5 uyuşmazlığında sahip, H19 çıktısını görmeden hakemlik eder.

**Karar:** Hangi iki okuyucu olacak ve H19 shadow'unu çalıştıran oturum olmayacaklar.

### d. `pricing.v0.1.json` (§6)

İlk birimden önce commitlenmeli:
- Jev çağrı veya token fiyatı;
- System Two okuyucu modelinin input/output fiyatı;
- para birimi ve tarih.

**Fiyatları ve model kimliklerini sahip yazmalı.** Ben Jev fiyatını bilmiyorum.

### e. Gözlenen actionable D5 (§5)

Mevcut review/CI kayıtlarından hangi kaynak okunacak:
- review yorumları;
- `development-review-*` iş akışı kayıtları;
- ya da PR'daki takip commit'leri.

Bu kaynak ve eşleme kuralı sabitlenmeli.

### f. Zamanlama

Bu ek ve `pricing.v0.1.json` mühürlenene kadar rutin gövdesi değiştiren PR'ların merge edilmemesi en temiz yol.
Aksi hâlde örneklemin ilk PR'ı fiyat tablosundan önce gözlenmiş olur (§6).
