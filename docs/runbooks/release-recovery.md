# F17-03: yayın, geri dönüş ve veri kurtarma

Bu belge bir **uygulanacak işletim prosedürüdür**; yapılmış production yayını, başarılı kurtarma provası veya MVP kabulü değildir. Kalıcı görev durumu [TASKS](../../TASKS.md), ürünün kabul koşulları [Faz 17](../plan/phase-17.md) ve [MVP kabul matrisi](../../MVP_ACCEPTANCE.md) üzerinden izlenir. Adaya ait sonuçlar ilgili PR'ın tek devir kaydında tutulur; burada ikinci bir canlı durum tablosu oluşturulmaz.

## 1. Üç işlemi birbirinden ayır

| İşlem | Gerçekte ne yapar? | Yerine geçmediği iş |
| --- | --- | --- |
| S05 staging `operation=rollback` | Yarım kalan anahtar rotasyonunun kayıtlı önceki Worker sürümünü ve geçiş durumunu doğrulayarak geri döner. | Genel ürün sürümünü veya veri migration'ını geri almak. |
| Uygulama sürümünü geri almak | Yeni şemayla çalıştığı kanıtlanan önceki uygulama/asset sürümüne kontrollü trafik dönüşü yapar. | Veritabanı ve fotoğraf içeriğini geçmiş zamana döndürmek. |
| Veri kurtarma | Ayrı, izole bir hedefte DB kayıtlarını ve ilgili Storage dosyalarını tutarlı bir kesite geri getirir. | Önceki uygulama sürümüne geçmek veya bir dump dosyasının varlığını göstermek. |

Mevcut `rollback`, `resume`, `rotate`, `bootstrap` ve `deploy` işlemlerinin yetkili tanımı [staging runbook](staging.md) içindedir. Bunların adları production dağıtımına uyarlanmış komutlar gibi kullanılmaz. Bu belge yeni bir production workflow'u, bakım modu, gönderim durdurma anahtarı veya otomatik kurtarma aracı eklemez.

## 2. Yayın adayını sabitle

Koordinatör, mevcut merge yetkisi kapsamında tek release adayı seçer. Aynı aday üzerinde birbirinden bağımsız branch'lerin yeşil sonuçlarını birleştirerek kabul üretmez.

Yayın kaydında şunlar birlikte bulunur:

- İncelenen commit, mevcut main, gerçekten derlenen checkout, Worker sürüm kimliği ve client asset/manifest kimlikleri.
- Migration envanteri ve uygulanmış migration kayıtları. Yalnız son sürümün veya dosya sayısının eşleşmesi şema eşitliği sayılmaz. Önceden birleştirilmiş migration dosyaları değiştirilmez.
- Aday için gereken CI run/job/attempt ve risk bazlı inceleme kanıtları. `skipped`, `unknown`, eksik log veya kota mesajı başarı değildir.
- Production ve staging'in farklı Worker, DB, Storage, origin ve credential kapsamları; üretimde test fixture'ının bulunmadığı doğrulaması.
- Yayın sorumlusu, olay halinde müdahale edecek kişi ve ürün kabul sorumlusu. Bu atamalar mevcut görev paketinde kalır; henüz atanmamış rol atanmış gibi gösterilmez.

Yeni ana dal değişiklikleri adaya taşınırsa yalnız etkilenen doğrulama güncellenir. Auth, erişim veya mali davranışın bağımsız incelemesi implementerin kendi testiyle ikame edilmez. Ayrıntılı risk bütçesi [ajan çalışma akışındadır](../plan/agent-workflow.md).

## 3. Staging kabulünü tamamla

### G16 sağlayıcı ve özel fotoğraf kabulü

NetGSM geçişini içeren aday için var olan G16 acceptance hattı kullanılır. PR #627'nin ilgili değişikliği adayda yoksa `run_g16_acceptance` seçeneğinin main'de var olduğu varsayılmaz.

İncelenmiş ve güncel ana dalla entegrasyonu doğrulanmış dal üzerinde **Staging deploy**, `operation=deploy`, `run_g16_acceptance=true` seçilir. G16'nın tek başına sınanması için ilgisiz F09/F10/S01 kapıları veya anahtar rotasyonu açılmaz. Bu, F17'nin birleşik kabulünde ayrıca gereken kapıları kaldırmaz.

Gerekli NetGSM adları `NETGSM_USERCODE`, `NETGSM_PASSWORD` ve yalnız kabul için kullanılan `NETGSM_ACCEPTANCE_PHONE`'dur. Değerler Git'e veya bu belgeye yazılmaz. Eksik değer tahmin edilmez. Kabul alıcısı yeniden denemeler arasında rastgele değiştirilmez; gereksiz gerçek gönderim tekrarı yapılmaz.

Provider'ın `00` cevabı gönderim isteğini kabul ettiğini kanıtlar; tek başına teslim/okunma veya müşterinin kodu girdiği anlamına gelmez. Telefon doğrulama, kodun tek kullanımlılığı ve randevu oluşturma sınırları ayrı uygulama kabulünde doğrulanır.

Storage kabulünde gerçek dosya yüklenir, sahibinin Worker ve Storage okumalarında içerik doğrulanır, başka işletme ve anonim erişim reddedilir, silme sonrası yokluk kanıtlanır. Her 4xx cevabı erişim engelleme başarısı sayılmaz. Temizlik başarısızsa sonuç PASS değildir; kurtarma için gerekli geçici yetki bağlamı körlemesine silinmez.

### Birleşik ürün kabulü

F17-04, [MVP_ACCEPTANCE](../../MVP_ACCEPTANCE.md) senaryolarını tek release adayında yürütür. İki işletme, üç rol, iki cihaz ve gerçek mobil tarayıcı kapsamı korunur. Müşteri rezervasyonu, randevu paneli, SalonApp, adisyon, bölünmüş manuel tahsilat, stok ve rapor aynı sürümde birlikte doğrulanır; paket, kampanya, prim, fotoğraf ve bildirim etkileşimleri dışarıda bırakılmaz.

M23 gerçek iş günü pilotudur ve F17-05'te kapanır. Staging veya CI sonucu M23 yerine yazılmaz; F17-04'ün M23'ü önceden istemesiyle bağımlılık döngüsü oluşturulmaz.

## 4. Yayın öncesi kurtarma kapsamı

**DB yedeği, Storage dosyasının yedeği değildir.** Supabase DB yedekleri Storage nesnelerinin metadata'sını kapsar; dosya içeriği ayrıca korunmalıdır. Sağlayıcının [yedekleme sınırı](https://supabase.com/docs/guides/platform/backups) açıkça kontrol edilir.

Kurtarma paketinin kapsamı aşağıdaki ilişkileri taşımalıdır:

| Veri grubu | Kurtarma sonrası kanıt |
| --- | --- |
| İşletme, üyelik, hizmet, personel ve çalışma saatleri | Aktif üyelik ve işletmeler arası erişim sınırı; hizmet/personel/saat ilişkileri. |
| Randevu grupları, satırlar, seri ve snapshot'lar | Grup/satır bağlantıları, zaman ve çakışma davranışı; eski snapshot'ın korunması. |
| Adisyon, ödeme, masraf ve stok hareketleri | Satır ve ledger ilişkileri, toplamlar ve gün sonu mutabakatı; kapalı kaydın değişmemesi. |
| Paket, kampanya ve prim | Kullanım/iade/komisyon kayıtları ve bakiye ilişkileri; aynı olaydan ikinci mali etki doğmaması. |
| Public ve private fotoğraflar | DB satırı ile doğru bucket/path/dosya eşleşmesi, içerik özeti ve erişim kuralları; public/private ayrımı. |
| Bildirim ve recovery durumu | Idempotency, şifreli yönetim materyali, tüketilmiş doğrulama/capability sınırları ve güvenli gönderim mutabakatı. |

Yedek envanteri; kayıt kimliği, UTC kesit zamanı, şema/migration kimliği, şifreleme yöntemi, erişim sahibi ve DB/Storage paketleri arasındaki eşleştirmeyi tutar. Gerçek nesne yolları, kullanıcı verisi ve yedek dosyaları halka açık PR/artifact'a yüklenmez. Public kanıta yalnız sansürlenmiş sonuçlar, sayılar ve geri döndürülemeyen özetler konur.

DB ile Storage bağımsız zamanlarda kopyalanıyorsa tutarlılık kendiliğinden oluşmaz. Teknik sahip, uygulanmış yazma durdurma/kesit veya sonradan mutabakat yöntemini seçer ve prova eder. Böyle bir mekanizma yoksa varmış gibi `maintenance=true` benzeri hayali ayar kullanılmaz; tutarlı kurtarma kanıtı açık kalır.

`MANAGEMENT_LINK_ENCRYPTION_KEY_V1` gibi şifreli veriyi okuyabilmek için gerekli anahtarların erişilebilirliği, değerleri açığa çıkarılmadan ayrıca doğrulanır. Yedeğin varlığı anahtarın varlığına kanıt değildir; anahtar kaybı yeni rastgele anahtarla onarılmış sayılmaz.

## 5. Ayrı hedefte kurtarma provası

1. Kaynak ve hedef kimliklerini açıkça karşılaştır. Hedef production veya kabul edilmeyen paylaşılan staging olamaz. Yeni ücretli kaynak gerekiyorsa maliyet ve mevcut yetki sınırı önce görünür olur.
2. Prova ortamında gerçek alıcılara gönderim, webhook ve zamanlanmış dış etkileri engelle. Kullanılacak kontrol gerçekten mevcut olmalıdır. Production credential'larını kopyalayıp sonra kapatmayı planlama.
3. DB ve dosyaları aynı kurtarma paketinden hedefe yükle. SQL migration geri alma veya fixture reset işlemiyle veri kurtarmayı taklit etme.
4. Yukarıdaki veri gruplarının ilişkilerini ve mali mutabakatını doğrula. Fotoğraf metadata'sı, dosya içeriği ve erişim kontrollerini birlikte sına. Okunamayan şifreli kayıtları ayrı hata say.
5. Dış sistemlerin geçmişe dönmediğini hesaba kat. Eski DB yedeğindeki bekleyen outbox kayıtları daha önce gerçekten gönderilmiş olabilir. Mutabakat yapılmadan kuyruğu yeniden gönderime açma; idempotency kayıtlarını topluca temizleme.
6. Gerçek veri kaybı penceresini ve kullanılabilirliğe dönüş süresini kaydet. Tam kullanılabilirlik süresi yalnız `pg_restore` çalışma süresi değildir; dosya kurtarma, erişim, anahtar ve ürün smoke adımlarını da içerir.
7. İzole hedefi ve geçici dosyaları kontrollü temizle. Başarısız temizlik ayrıca raporlanır; asıl hata kaybolmaz. Prova sonucu ancak bütün zorunlu kontroller tamamlanınca kabul edilir.

CI'de aynı kümedeki disposable DB'ye yapılan restore, bu geniş provanın alt kanıtıdır. `storage_bytes=NOT_COVERED` kaydı olan koşu hosted DB+Storage kurtarma kabulü değildir.

**Hedef ile ölçümü ayır:** Ziya/ürün sahibi kabul edilebilir veri kaybı penceresini ve kesinti hedefini belirler; teknik sahip provada gerçekleşen değerleri ölçer. Bu belge süre veya hizmet seviyesi uydurmaz. Ölçülen sonuç onaylı hedefi karşılamıyorsa pilot öncesi sahibi ve düzeltme kararı kaydedilir.

## 6. Uygulama yayını ve sürüm geri dönüşü

Önceki sürümün yeni şemayla uyumu gösterilmeden geri dönülebilir denmez. Seçilen eski kod, ileri migration uygulanmış ayrı hedefte kritik okuma/yazma ve mali akışlarla sınanır. Yeni şema eski kodla uyumsuzsa varsayılan çözüm veriyi geriye zorlamak değil, incelenmiş ileri düzeltmedir.

Trafik değişmeden önce aktif Worker sürümü, client asset kimliği, route/origin/binding ilişkileri, migration durumu ve anahtar devamlılığı doğrulanır. Staging'in anahtar/binding kontrollerini atlayan kestirme bir production komutu bu runbook'tan türetilmez.

Yayın yalnız doğrulanmış production dağıtım yolu üzerinden yapılır. Operatör incelenmiş kod/asset çiftinin aktive edildiğini ve gerekli zamanlanmış görevlerin doğru sürümde çalıştığını doğrular. Cloudflare'da [sürüm geri dönüşü](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) bağlı veritabanını eski haline getirmez.

| Olay | Karar |
| --- | --- |
| Aktivasyon öncesi doğrulama başarısız | Adayı aktive etme; hata ve mevcut aktif sürümü kaydet. |
| Yeni uygulama sorunlu, önceki sürüm güncel şemayla kanıtlı uyumlu | Kaydedilmiş code/asset sürümüne kontrollü dönüş; ardından smoke, outbox ve mali mutabakat. |
| Şema uyumluluğu bilinmiyor veya yeni veri davranışı eski kodu bozuyor | Kör rollback yok. İncelenmiş ileri düzeltme; gerçek yazma durdurma yöntemi varsa operasyon sorumlusu uygular. |
| Veri kaybı/bozulması var | Sürüm değiştirmeyi kurtarma sayma. Olay kapsamı korunur; ayrı hedef kurtarma ve veri mutabakatı süreci başlatılır. |
| Yarım anahtar rotasyonu var | Yalnız kayıtlı S05 `resume`/`rollback` prosedürü ve aynı işlem bağlamı kullanılır. |

Çapraz işletme erişimi, çift tahsilat/ledger etkisi, veri kaybı veya özel fotoğrafın açılması pilotu durduran bulgulardır. Hatalı kayıtları sessizce silerek veya audit'i değiştirerek yayını yeşile çevirme.

## 7. İzleme ve yeniden açma

Kontrol sahibi, API başarısızlığı, provider hata sınıfı, pending outbox büyüklüğü/en yaşlı kayıt, başarısız gönderim, zamanlanmış görev heartbeat'i ve başarısız fotoğraf temizliğini izleyebildiğini kanıtlar. Mevcut olmayan bir alarm, dashboard veya otomatik durdurma mekanizması kurulmuş sayılmaz.

Auth/session hop sayısı, takvim bootstrap/refresh round trip ve p50/p95, route JS/CSS ölçümleri adayla birlikte kaydedilir. Build grafiği gerçek mobil ağ ölçümü değildir. Marketing root cutover sonrası `/r/*` ve `/app/*` için gereksiz marketing/video yüklenmediği ayrıca gözlenir. Mevcut bütçe dışındaki keyfi eşikler bu belgeyle yeni feature blocker yapılmaz.

Yeniden açma için kimlik/şema/binding uyumu, kritik smoke, tenant sınırları, ödeme/stok mutabakatı, kuyruk güvenliği ve olayın sorumlu tarafından kapatıldığı kayıt birlikte aranır. Public loglarda telefon, OTP, parola, connection string, cookie, yönetim token'ı veya fotoğraf içeriği bulunmaz.

## 8. Saklama ve silme kararları

Teknik sahibi ile ürün sahibi; özel fotoğrafın amacı ve saklama süresi, müşteri silme talebi, yedekteki kopyanın ömrü, erişim sahibi ve olay kurtarmasındaki yeniden-silme sürecini mevcut ürün kararlarına bağlar. Public galeriye yayınlama izni ile özel arşiv erişimi aynı karar değildir.

Bu belge yeni bir hukuki süre, KVKK uygunluk beyanı veya otomatik silme sistemi ilan etmez. Geri yükleme silinmiş veriyi yeniden ortaya çıkarabiliyorsa silme kayıtları yeniden uygulanmadan ortam kullanıcıya açılmaz. Gerçek uygulama/test veya açık owner kararı olmayan sınır F17-04'te görünür kalır.

## 9. Adaya bağlı devir kaydı

Aşağıdaki bilgiler mevcut PR/incident kaydına eklenir; ayrı bir zorunlu tracker veya her push'ta yeni belge gerekmez:

```text
Aday / gerçekten test edilen checkout / ortam:
Worker sürümü / client asset kimliği / migration envanteri:
Gerekli CI ve bağımsız inceleme kanıtı:
Gerçek sağlayıcı kabulünün sınırı:
DB ve Storage kurtarma paketinin güvenli referansı:
İzole prova ve bütünlük / yetki / mali mutabakat sonucu:
Onaylı veri kaybı ve kesinti hedefi / ölçülen sonuç:
Şema uyumlu eski sürüm veya ileri düzeltme yolu:
Olay ve destek sorumlusu:
Açık sınırlar / sahip / sonraki tek işlem:
```

F17-03 bu prosedürün yazılmasıyla kapanmaz. Gerekli prova ve yayın hazırlığı kanıtı, F17-04 ortak sürüm kabulü ve F17-05 gerçek işletme günü ayrı sonuçlardır.
