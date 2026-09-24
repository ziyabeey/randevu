# H19s: gerçek PR akışında shadow router testi (ön kayıt)

**Sürüm v0.1, terminal Kepenk-adapter gate'i.** Bu dosya ilk H19s uygun PR birimi gözlenmeden önce yazılır.
Bu commit'ten sonra örnekleme, router kuralı, referans etiket, maliyet hesabı veya kabul gate'i değiştirilirse
H19s geçersiz olur ve yeni, ileriye dönük bir protokol gerekir.

H19u sentetik prospective sette U1–U5'i geçti. H19s bunun gerçek geliştirme akışına taşınıp taşınamayacağını
ölçer. **Shadow-only** çalışır: hiçbir PR, CI, review veya merge kararı H19s tarafından engellenmez ya da
değiştirilmez. Mevcut System Two review bütün uygun birimlerde normal biçimde çalışmaya devam eder.

Bu, Kepenk/Randevu D0–D5 adapter hattının **son doğrulama kapısıdır**:
- geçerse adapter v1 dondurulur ve paketleme/shadow ürün entegrasyonuna geçilir;
- kalırsa mevcut adapter için yeni harfli sentetik optimizasyon deneyi açılmaz; router production'a terfi etmez.

## 1. Donmuş candidate router

Model: `jev-1.13.0`.

### Aşama 1 — V

DE-JEV-H19-R0 v0.1 altı eksen sorusu aynen çalışır.

```text
high_D5 := P(D5) >= 0.64
high_D1 := P(D1) >= 0.64
```

### Aşama 2 — yalnız belirsiz mahallede resolver

```text
ambiguous := high_D5 && high_D1
```

H19U-RESOLVER v0.1 Choice aynen kullanılır:
`D1_ONLY | D5_ONLY | BOTH | NEITHER_OR_OTHER`.

Resolver yalnız aynı diff/context girdisini görür. V skorları, `high_D1/high_D5` bayrakları ve deterministik
facts resolver prompt'una verilmez.

### Candidate route

```text
if P(D5) < .64:
    no-route
else if P(D1) < .64:
    route
else:
    route iff resolver in {D5_ONLY, BOTH}
```

Baseline:
```text
route every eligible unit to System Two
```

H19s boyunca threshold, prompt, skor veya üçüncü soru değişmez.

## 2. Gözlem birimi ve kapsam

H19s v0.1 yalnız mevcut kanıtın kapsadığı **PostgreSQL/PLpgSQL transactional adapter**'ı sınar.

Bir **eligible unit**:
- protokol commit'inden sonra merge edilen bir PR'ın final base→merge diff'inde;
- `supabase/migrations/**/*.sql` altında;
- gövdesi değişen bir `function`, `procedure` veya executable trigger function'dır.

Bir PR aynı fonksiyonu birden çok commit'te değiştirse de final merge diff'inde **tek birim** sayılır.
Aynı fonksiyon daha sonraki başka PR'da yeniden değişirse yeni gerçek trafik olayıdır ve yeni birim sayılır.

Dışarıda:
- docs/tests;
- yorum-only değişiklik;
- yalnız grant/revoke/index/table DDL ve executable routine gövdesi değiştirmeyen migration;
- generated fixture;
- H19 araştırma klasörünün kendi değişiklikleri.

Eligible extraction deterministik script ile yapılır; manuel "ilginç vaka" seçimi yasaktır.

## 3. Ardışık örneklem ve stop rule

Protokol commit'inden sonraki **ardışık merged code PR'ları** alınır.

Toplama, her iki koşul da sağlanana kadar sürer:
- en az **150 eligible unit**;
- en az **25 ayrı merged PR**.

İki eşik aynı PR içinde aşılırsa o PR'ın tüm eligible unit'leri dahil edilir. Stop rule gerçek etikete,
H19 skoruna veya review sonucuna bakmaz.

Aynı PR'ın synchronize/head denemeleri ayrı örnek değildir; yalnız final merge diff'i ölçüme girer.

## 4. Shadow yürütme

Her eligible unit için:
1. final diff + gerekli fonksiyon bağlamı çıkarılır;
2. V çalışır;
3. yalnız `P(D5)>=.64 && P(D1)>=.64` ise resolver çalışır;
4. candidate route sonucu kaydedilir;
5. **mevcut System Two review yine de çalışır**.

H19 çıktısı PR yazarına, CI gate'ine veya referans labeler'lara gösterilmez. Ölçüm bitene kadar H19 sonucu
yalnız shadow artifact olarak saklanır.

Her kayıtta:
- PR no / merge SHA;
- path + symbol;
- input digest;
- V ve resolver sürüm/hash'i;
- olasılıklar / Choice;
- candidate route;
- token, latency ve sağlayıcı maliyet verisi;
- mevcut System Two review receipt'i
saklanır.

## 5. Referans etiket: H19'dan kör

Her eligible unit, H19 çıktısı gösterilmeden iki bağımsız System Two okuyucu tarafından şu iki binary eksende
etiketlenir:

- **D1 materially involved?** yes/no/undetermined
- **D5 materially involved?** yes/no/undetermined

Ayrıca:
- `actionable_D5`: reviewer bu D5 bulgusu nedeniyle kod/test değişikliği ister miydi? yes/no
- kısa gerekçe
kaydedilir.

İki okuyucu D5 konusunda uyuşmazsa H19 sahibi, H19 shadow çıktısını görmeden adjudication yapar.
`undetermined` kalan birimler primary recall/FPR'den çıkarılır fakat oranları ayrıca raporlanır.

D1_ONLY := D1=yes ve D5=no.
D5_INVOLVED := D5=yes (D1 ne olursa olsun).

Gerçek mevcut review/CI sırasında concurrency/version/locking/race nedeniyle kod veya test değişikliği
istenmişse bu ayrıca **observed actionable D5** olarak işaretlenir; bu işaret candidate sonuçlarından bağımsızdır.

## 6. Fiyat/maliyet kaydı

İlk eligible unit'ten önce `h19s/pricing.v0.1.json` commitlenir:
- Jev input/output veya call fiyatı;
- kullanılan System Two model(ler)inin input/output fiyatı;
- para birimi ve tarih.

Deney sırasında fiyat değişse bile primary karşılaştırma bu frozen fiyat tablosuyla yapılır; gerçek invoice
maliyeti ikincil olarak raporlanabilir.

### Baseline cost

Gerçekte bütün eligible unit'lerde çalıştırılan mevcut System Two review'un frozen fiyatlarla hesaplanan toplamı.

### Candidate simulated cost

```text
V(all units)
+ resolver(ambiguous units)
+ System Two(candidate routed units)
```

System Two'nun candidate tarafından route edilmeyen birimlerde gerçekte shadow amacıyla çalışmış olması
candidate maliyetine dahil edilmez; bu karşı-olgusal tasarruf hesabıdır.

## 7. S1 — güvenlik / kaçırmama

Primary gate:

- D5_INVOLVED recall ≥ **%95**
- actionable_D5 recall = **%100**
- observed actionable D5 miss = **0**
- D5=no birimlerde candidate FPR ≤ **%35**

Point estimate gate'tir; Wilson %95 aralıkları ayrıca raporlanır.

Bir actionable D5 miss varsa diğer bütün maliyet gate'leri geçse bile H19s kalır.

## 8. S2 — D1/D5 mekanizması gerçek trafikte de çalışıyor mu?

D1_ONLY birimlerde:
- candidate route/FPR ≤ **%30**.

Belirsiz mahalleye düşen D1_ONLY birim sayısı ≥5 ise ayrıca:
- resolver bu birimlerin ≥ **%80**'ini no-route yapmalıdır.

Belirsiz D1_ONLY <5 ise ikinci madde "insufficient n" olarak raporlanır ve H19s'i tek başına düşürmez;
ilk FPR gate'i yine geçmelidir.

## 9. S3 — System Two yükü

Baseline bütün eligible unit'leri System Two'ya gönderir: %100.

Candidate:
- System Two route oranı ≤ **%85**
- yani en az **15 yüzde puan** gerçek trafik route azalması.

Ayrıca en az 25 PR'ın:
- ≥%50'sinde candidate, baseline'a göre en az bir System Two unit çağrısını kaldırmalıdır.

Bu ikinci madde kazancın tek bir dev migration PR'ından gelmesini engeller.

## 10. S4 — toplam ekonomik maliyet

Frozen pricing ile:

```text
saving = 1 - candidate_simulated_cost / baseline_cost
```

Gate:
- toplam model maliyeti tasarrufu ≥ **%15**.

Ayrıca:
- V median latency;
- resolver median/p95 latency;
- candidate path'in ek System One latency'si
raporlanır.

Latency H19s primary pass/fail gate'i değildir; production entegrasyonu öncesi bütçe girdisidir.

## 11. S5 — dağılım / drift kontrolü

Ardışık örneklem eligible-unit sırasına göre iki yarıya bölünür.

Her yarıda:
- D5 recall ≥ **%90**
- System Two route azalması ≥ **%10**.

Ayrıca PR-level bootstrap ile:
- D5 recall;
- System Two route reduction;
- cost saving
için %95 aralıklar raporlanır.

Bu bootstrap eşik seçmek veya gate değiştirmek için kullanılmaz.

## 12. İkincil raporlar

Gate değildir:
- gerçek D1_ONLY / D5_ONLY / BOTH / OTHER prevalansı;
- ambiguous neighborhood prevalansı;
- cue / lock_context kırılımı;
- function family;
- PR büyüklüğü;
- H19u sentetik set ile gerçek trafik dağılım farkı;
- resolver confusion matrix;
- System Two bulgu kategorileri;
- token ve latency dağılımı.

Hiçbir ikincil sonuçtan yeni threshold/prompt aynı örneklem üzerinde türetilmez.

## 13. Sonuç kuralı

H19s yalnız **S1 + S2 + S3 + S4 + S5** birlikte geçerse başarılıdır.

### Geçerse

Desteklenen dar iddia:

> Kepenk/Randevu'nun gerçek, ardışık transactional SQL PR trafiğinde H19u'da dondurulan iki aşamalı System
> One router, actionable D5 bulgularını kaçırmadan mevcut System Two review yükünü ve toplam model maliyetini
> anlamlı biçimde azalttı.

Sonraki adım **yeni H19 deneyi değildir**:
- Kepenk H19 adapter v1 dondurulur;
- önce shadow entegrasyon kalıcılaştırılır;
- ücretsiz araç için Experiment Core + Kepenk adapter paketlenir;
- başka repo/domain için yeni adapter validasyonu ayrı bir araştırma hattı olarak başlar.

### Kalırsa

- candidate production review gate'i olmaz;
- aynı gerçek trafik örnekleminde threshold/prompt/router tuning yapılmaz;
- Kepenk adapter v1'in router özelliği "research-only" olarak kalır;
- H19 Experiment Core ve deney ledger'ı yine araçlaştırılabilir;
- mevcut Kepenk adapter için yeni harfli sentetik deney açılmaz.

## 14. Yasaklar

- Shadow sırasında PR/CI kararını H19 ile değiştirmek.
- Labeler'a H19 skorunu göstermek.
- Stop rule'u sonuçlara göre uzatmak/kısaltmak.
- Aynı PR head'lerini bağımsız örnek saymak.
- H19s örnekleminde threshold sweep/prompt search.
- Ucuz görünen bir alt grubu post-hoc production kapsamı yapmak.
