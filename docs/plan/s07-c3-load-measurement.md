# S07-C3 — Sentetik yük ve ölçüm sözleşmesi

**13 Eylül 2026.** Başlangıç main'i `ff6700dd27cc72fe1855124349fa848b8d6517ef`. C1 retention ve C2 sayfalama/DB bütçeleri main'de ve merge sonrası CI yeşildir. Bu belge yalnız C3 ölçüm kapsamını sabitler; runtime, migration, workflow, staging, secret veya production verisi değiştirmez.

## Amaç ve yorum sınırı

C3 yeni bir performans özelliği veya production SLA çalışması değildir. Amaç, C2 ile sınırlandırılmış iki temsilî DB okuma yolunu gerçekçi fakat sentetik fixture üzerinde tekrar tekrar çalıştırıp başlangıç maliyetini görünür kılmaktır.

Her ölçüm en az şu kanıtı üretir:

- fixture / işlenen mantıksal kayıt sayısı;
- ölçülen DB çağrısı sayısı;
- warm-up sayısı ve ölçüm örneği sayısı;
- ölçüm toplam süresi;
- örnek başına p50 ve p95;
- hata / timeout sayısı.

CI veya disposable PG17 sonucu **kapasite garantisi, production SLA, sağlayıcı fiyatı veya gerçek müşteri trafik tahmini değildir**. Mutlak süreler yalnız aynı run'ın gözlemidir. C3 hiçbir limite ölçüm sonucu hızlı diye genişleme yetkisi vermez.

## Güvenlik sınırları

- Yalnız disposable PostgreSQL 17 ve sentetik kayıtlar kullanılır. Production/staging müşteri verisi, e-posta, telefon, capability veya recovery sırrı fixture değildir.
- Fixture kurulum süresi p50/p95 örneklerine katılmaz. Ölçümden önce warm-up tamamlanır.
- Ölçüm sorgusu davranış değiştiren yazım yapmaz; fixture transaction sonunda rollback edilir.
- C2'deki `5s` statement timeout, 25/100 sayfalama ve 100/100/5000 snapshot sınırları korunur. Benchmark uğruna timeout veya limit gevşetilmez.
- Tek bir sıcak koşu kabul değildir. Her workload için **3 warm-up + 30 ölçüm örneği** zorunludur.
- Her örnek tek tek kaydedilir; p50/p95 sonradan yalnız başarılı örneklerden hesaplanıp başarısız örnek gizlenmez. Herhangi bir timeout/hata varsa workload başarısızdır.
- Metrik formatı sabit, logdan aranabilir tek satır olmalıdır; örnek: `S07_C3_METRIC workload=... warmup=3 samples=30 rows=... db_calls=... total_ms=... p50_ms=... p95_ms=... errors=0`.

## Workload A — maksimum atomik katalog snapshot'ı

C2b'nin gerçek üst sınırı doğrudan ölçülür:

- 1 işletme + 1 aktif owner membership;
- 100 hizmet;
- 100 personel;
- 5.000 personel-hizmet eşleşmesi;
- `get_catalog_snapshot(...)` tek DB çağrısı / örnek;
- her başarılı örnekte yanıtın 100 hizmet, 100 personel ve 5.000 eşleşmeyi eksiksiz taşıdığı tekrar doğrulanır.

Ölçüm iş sinyali:

- **5.200 mantıksal katalog satırı / snapshot**;
- 30 ölçüm örneğinde **30 DB çağrısı**;
- warm-up ayrıca 3 çağrı olarak raporlanır fakat p50/p95 örnek kümesine girmez.

Stop koşulu: 5.001 eşleşme veya 101 hizmet/personel üretip benchmark'ı geçirmeye çalışma yoktur; bunlar C2b negatif kabulüdür ve açık limit sonucu vermeye devam eder.

## Workload B — büyük tabloda bounded booking sayfası

C2a sayfalama sorgusunun büyük tablo üzerindeki ilk sayfa maliyeti ölçülür. Fixture:

- tek işletme ve aktif membership;
- en az 2.500 sentetik appointment;
- exclusion constraint'i bozmayan deterministik personel/zaman dağılımı;
- `list_appointments_page(..., 101, null, null)` ile Worker'ın `limit=100 + 1 probe` DB şekli;
- her başarılı örnekte 101 satır ve deterministik `(starts_at,id)` sırası doğrulanır.

Ölçüm iş sinyali:

- **2.500 kayıtlı appointment** üzerinde **101 satırlık bounded DB sonucu / örnek**;
- 30 ölçüm örneğinde **30 DB çağrısı**;
- 3 warm-up çağrısı ölçüm kümesinin dışındadır.

Bu workload tam liste tarama throughput'u değildir. Çok sayfalı kayıt atlama/çoğaltma doğruluğu C2a kabulünde kalır; C3 burada bounded sorgunun tekrar maliyetini ölçer.

## Ölçüm ve kabul yöntemi

Disposable PG17 testi aşağıdaki sırayı uygular:

1. Sentetik fixture transaction içinde kurulur.
2. Yetkili `auth.uid()` bağlamı oluşturulur.
3. Workload başına 3 warm-up çalışır ve sonuç şekli doğrulanır.
4. Workload başına 30 çağrı ayrı ayrı `clock_timestamp()` ile ölçülür.
5. Her örnek `{workload, sample_no, elapsed_ms}` biçiminde geçici ölçüm tablosuna yazılır.
6. `percentile_cont(0.50)` ve `percentile_cont(0.95)` ile p50/p95; `sum(elapsed_ms)` ile toplam süre hesaplanır.
7. Sabit `S07_C3_METRIC` receipt'i yazılır.
8. `samples=30`, `errors=0`, `p50>0`, `p95>=p50`, beklenen sonuç büyüklüğü ve çağrı sayıları assert edilir.
9. Transaction rollback edilir.

Mutlak p50/p95 için CI'ya kırılgan bir milisaniye eşiği yazılmaz. Güvenlik bütçesi mevcut 5 saniyelik DB statement timeout'tur: bu bütçeye çarpan herhangi bir örnek açık başarısızlıktır ve limit yükseltilmez. Önce plan/index/fixture nedeni incelenir.

## CI ve kanıt

C3 code PR'ında:

- yeni sentetik ölçüm testi canonical PostgreSQL planına eklenir;
- eski plan sırası korunur;
- `verify-ci-coverage` yeni SQL testini gerçekten çalıştırıldığını görür;
- exact-head required CI yeşil olmadan ölçüm kabul edilmez;
- CI logunda iki `S07_C3_METRIC` receipt'i bulunur ve değerleri PR kabul notuna yazılır;
- receipt'ler 'bu runner üzerindeki gözlem' olarak etiketlenir.

C3 ölçümü yalnız disposable PG17 kanıtıdır. C4'te aynı kabul edilen code head gerçek staging'e taşınır; staging smoke/auth/F09 zinciri, retention, pagination ve örnek yük kanıtı ayrıca exact-head olarak doğrulanır.

## Rollback

C3 runtime/migration davranışı değiştirmemelidir. Beklenen code paketi yalnız test/ölçüm harness'i ve canonical CI planına yeni test adımıdır. Rollback bu test adımını ve ölçüm dosyasını kaldırmaktır; uygulama verisi veya şeması geri alınmaz.

## C3 code PR stop koşulları

- Fixture production/staging PII'sine ihtiyaç duyuyorsa dur.
- Benchmark için mevcut timeout/limit yükseltme ihtiyacı doğarsa dur ve nedenini incele.
- Ölçüm tek örneğe veya yalnız toplam süreye düşüyorsa kabul etme.
- p95 yalnız başarılı örneklerden hesaplanırken hata sayısı ayrıca sıfır değilse kabul etme.
- Katalog benchmark'ı raw REST `staff_services` listesine geri dönüyorsa dur; C2b'nin tek atomik DB snapshot sınırı korunur.
- Booking workload'u index'i devre dışı bırakan veya fixture'ı gerçek sorgu şeklinden farklılaştıran özel yol kullanıyorsa kabul etme.

## Sonraki adım

Bu docs-only kontrat exact-head CI ile main'e alındıktan sonra yeni main'den ayrı `s07-c3-load-measurement` code branch'i açılır. İlk uygulama sentetik fixture + receipt üreten PG17 testidir; runtime dosyaları değişmez.
