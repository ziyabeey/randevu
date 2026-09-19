# S07-C — Güvenli operasyon kapanış sözleşmesi

**13 Eylül 2026.** Bu belge S07'nin kalan C paketlerini güvenli, geri alınabilir ve kanıtlanabilir biçimde kapatmak için bağlayıcı çalışma sınırıdır. Başlangıç main'i `16e822e2f629c1646223582fa8975aeb50b96fbc`; bu branch yalnız sözleşme/dokümantasyon değiştirir. Runtime, migration, workflow, secret ve staging bu PR'da değişmez.

## Amaç

S07 A ve B paketleri main'dedir. C kapanışı dört ayrı teslim olarak yürütülür:

1. **C1 — retention / terminal PII güvenliği**
2. **C2 — sayfalama ve DB sorgu/bekleme bütçeleri**
3. **C3 — örnek yük, p50/p95 ve maliyet/iş sayısı ölçümü**
4. **C4 — exact-head gerçek staging kabulü ve S07 kapanışı**

Bu paketler yeni ürün özelliği değildir. Hizmet/personel/takvim UX'i, yeni telemetri servisi, yeni ücretli kaynak, F10+ ürün işi ve S08 bu sözleşmenin dışındadır.

## Ortak güvenlik kuralları

- **Tek yazıcı:** Ortak SQL/router/auth/workflow dosyalarında aynı anda birden fazla uygulayıcı olmaz. Her paket güncel main'den başlar.
- **Küçük blast radius:** C1, C2 ve C3 ayrı code PR'larıdır. Bir paket diğerinin değişikliğini önkoşul yapıyorsa önceki paket main'e alınmadan sonraki yazılmaz.
- **Exact-head:** Kabul edilen CI head'i ile staging'de çalıştırılan code head aynı olmalıdır. Başka main, eski yeşil run veya benzer tree kabul kanıtı değildir.
- **Önce negatif test:** Silme, grant, timeout veya limit davranışı uygulanmadan önce korunması gereken durumların negatif kabulü yazılır veya mevcut testte somut olarak gösterilir.
- **Sessiz eksiltme yok:** Limit, timeout veya sayfalama kullanıcıya eksik veri veriyorsa bunu başarılı tam sonuç gibi sunamaz. Devam/cursor veya açık limit sonucu gerekir.
- **Rollback önce tanımlanır:** Her code PR'ında geri dönüş yolu, veri etkisi ve yeniden doğrulama adımı PR açıklamasında bulunur.
- **Production üzerinde keşif yok:** Destructive seçim, yük fixture'ı veya ACL deneyi staging/disposable DB üzerinde kanıtlanır. Production müşterisi/PII'si deney verisi değildir.
- **Kanıt sınıfları ayrılır:** Unit/Node, disposable PG17, browser fixture, staging ve gerçek provider kanıtları birbirinin yerine yazılmaz.

## C1 — Retention / terminal PII

### Korunan invariantlar

- Aktif veya toparlanabilir booking/recovery kaydı prune edilmez.
- Replay/idempotency için hâlâ gerekli materyal retention tarafından erken kaldırılmaz.
- Aktif notification işi, geçerli lease veya belirsiz provider sonucu varsa ilişkili gerekli materyal korunur.
- Terminal kayıt, mümkün olan en dar kanıtı taşır; müşteri PII'si, capability, recovery proof/secret veya tam payload terminal geçmişte tutulmaz.
- Bir cleanup koşusu aynı satırı tekrar gördüğünde idempotent davranır.

### Zorunlu çalışma sırası

1. Hangi tablolar/sütunlar terminal PII veya recovery materyali taşıyor envanterlenir.
2. Destructive değişiklikten önce **read-only aday seçimi** yapılır; korunacak ve temizlenecek örnek durumlar test fixture'ında ayrılır.
3. Aday sayısı ve nedenleri test çıktısında doğrulanır.
4. Cleanup bounded batch ile uygulanır; tek koşuda sınırsız tarama/silme yoktur.
5. Cleanup sonrası recovery/replay/notification gerileme testleri çalışır.

### Stop koşulları

- Aday sorgu aktif/pending/leased bir kaydı seçerse paket durur.
- Hangi alanın PII sayıldığı veya replay için gerekli olup olmadığı belirsizse DELETE/NULL yazılmaz; önce sözleşme daraltılır.
- Migration rollback'i veri kaybını geri getiremiyorsa ilk kabul yalnız staging fixture üzerinde yapılır ve irreversible sınır açıkça kaydedilir.

## C2 — Sayfalama ve DB bütçeleri

### Korunan invariantlar

- İlk sayfanın başarılı olması listenin tamamının başarılı olduğu anlamına gelmez.
- 0, 1, `limit-1`, `limit`, `limit+1` ve çok sayfalı fixture kabulü bulunur.
- Sıralama deterministik olmalıdır; sayfalar arasında kayıt atlama/çoğaltma test edilir.
- Timeout veya sorgu bütçesi kullanıcıya sahte boş liste üretmez.
- Meşru büyük işletme sessizce kırpılmaz; devam mekanizması veya açık bounded hata kullanılır.
- Statement/lock timeout bir HTTP abort'un sunucu sorgusunu kesin iptal ettiği iddiasına dönüştürülmez.

### Kabul

- Liste uçlarının her biri için query/list budget envanteri çıkarılır.
- Bounded query/maintenance yolu index ve plan davranışıyla birlikte disposable PG17'de test edilir.
- Timeout, lock bekleme ve limit aşımı açık hata/continue semantiği taşır.
- Eski küçük veri seti davranışı aynı kalır.

## C3 — Örnek yük ve ölçüm

- Fixture gerçekçi ama sentetiktir; production müşteri verisi kullanılmaz.
- En azından işlenen kayıt sayısı, DB çağrı sayısı veya eşdeğer maliyet sinyali, toplam süre ve p50/p95 kaydedilir.
- Ölçüm tek bir sıcak koşuya dayanmaz; warm-up ve örnek sayısı kaydedilir.
- CI/staging ölçümü **kapasite garantisi** veya production SLA diye raporlanmaz.
- Ölçüm mevcut başlangıç bütçesini aşıyorsa limit gevşetilmez; önce sorgu/indeks/batch nedeni incelenir.

## C4 — Gerçek staging ve kapanış

Aynı kabul edilen code head üzerinde:

- routine staging deploy;
- mevcut zorunlu smoke/auth zinciri;
- gerçek F09 booking/recovery/idempotency/capability zinciri;
- v2 timeout/resolve;
- refresh ve iki-tab recovery davranışı;
- retention cleanup sonrası korunması gereken recovery/replay davranışı;
- pagination sınırı ve örnek yük kanıtı;
- fixture/pending/versiyon durumunun temiz readback'i

doğrulanır.

Staging run'ı başarısızsa code head değiştirilmeden yeniden deneme yalnız transient altyapı nedeni somut kanıtlanırsa yapılır. Davranış hatasında yeni commit gerekir ve bütün ilgili kabul zinciri yeni head üzerinde tekrar çalışır.

## PR başına zorunlu kontrol listesi

- [ ] Güncel main SHA ve açık PR sahipliği kaydedildi.
- [ ] Değiştirilecek dosya sınırı yazıldı; ortak dosyalarda ikinci yazıcı yok.
- [ ] Negatif test önce veya aynı commit serisinde mevcut.
- [ ] Destructive/ACL/timeout etkisi ve rollback yolu açıklandı.
- [ ] Unit/Node + typecheck/build gerektiği kadar geçti.
- [ ] İlgili PG17/Chrome kabulü geçti.
- [ ] CI required gate exact head üzerinde yeşil.
- [ ] Review konuşmaları kapalı ve ruleset bypass edilmedi.
- [ ] Staging gerekiyorsa exact head ile çalıştı.
- [ ] Canlı durum yalnız TASKS'ta kanıt alındıktan sonra güncellendi; S07 handoff tarihsel kanıt olarak eşlendi.

## Bir sonraki somut adım

C1 için güncel main'de terminal/recovery/notification veri ömrü envanteri çıkarılır. İlk code PR destructive cleanup ile başlamaz; önce korunacak/silinecek durumların read-only seçim ve negatif test sözleşmesini kanıtlar. Somut schema incelemesi bu kontratı daraltabilir ama güvenlik invariantlarını gevşetemez.
