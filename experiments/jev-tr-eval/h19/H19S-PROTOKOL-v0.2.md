# H19s v0.2: gerçek PR akışında API-eklemeden shadow router testi (ön kayıt)

**Durum: MÜHÜRLÜ, örneklem başlamadan önce v0.1'i geçersiz kılar.**
H19s v0.1 (`c9b6fca`) sonrası `main` üzerinde yeni commit olmadığı doğrulanmıştır; dolayısıyla v0.2'ye geçiş
hiçbir gerçek örneği görmeden yapılır. v0.1'in OpenAI-API fiyat/okuyucu kolu kullanılmaz.

H19u sentetik prospective sette U1–U5'i geçti. H19s'in tek amacı gerçek geliştirme trafiğinde iki şeyi ölçmektir:

1. actionable D5 kaçırmadan System Two review yükünü azaltıyor muyuz?
2. D1/D5 ayrıştırma gerçek PR dağılımında da çalışıyor mu?

**H19s yeni bir OpenAI API hattı kurmaz.** Jev, test edilen System One olduğu için TypeSafe/Jev çağrıları
devam eder. System Two referansları mevcut review süreci ve kör, bağımsız ürün oturumlarından gelir.

Bu Kepenk/Randevu adapter hattının terminal gate'idir.

## 1. Donmuş candidate router

H19u ile aynen:

```text
high_D5 := P(D5) >= 0.64
high_D1 := P(D1) >= 0.64

if !high_D5:
    no-route
else if !high_D1:
    route
else:
    resolver := H19U-RESOLVER-v0.1(diff only)
    route iff resolver in {D5_ONLY, BOTH}
```

Resolver V skorlarını/facts'i görmez.

Baseline:
```text
route every eligible unit to System Two
```

Threshold/prompt/router H19s boyunca değişmez.

## 2. Eligible unit

- protokol v0.2 freeze sonrasındaki ardışık merged PR'lar;
- `supabase/migrations/**/*.sql`;
- final base→merge diff'inde executable function/procedure/trigger-function gövdesi değişen routine;
- **new routine dahil**;
- comment/whitespace-only ve routine dışı DDL hariç;
- aynı PR'da aynı final-effective routine bir birim.

Her birimde `change_kind = new|modified` tutulur. Bu kırılım ikincil raporda zorunludur, gate değildir.

## 3. Ardışık örneklem ve stop rule

İki koşul birlikte sağlanana kadar:
- ≥150 eligible unit
- ≥25 ayrı eligible merged PR

Son eşiği aşan PR'ın bütün birimleri dahil edilir. Sonuçlara bakarak erken durma/uzatma yoktur.

## 4. Shadow

Her eligible unit:
1. deterministic extractor ile çıkarılır;
2. Jev V çalışır;
3. yalnız iki eksen de ≥.64 ise Jev resolver çalışır;
4. candidate route gizli shadow artifact olarak kaydedilir;
5. normal development-engine review akışı hiçbir şekilde değişmez.

H19 sonucu PR yazarına, reviewer'a veya CI gate'ine gösterilmez.

## 5. Referans etiketler, ekstra API yok

Örneklem stop rule'a ulaştıktan sonra H19 shadow sonuçları kapalı tutulur ve yalnız unit paketleri dışa aktarılır.

İki bağımsız **ürün oturumu** aynı frozen label promptunu ayrı ayrı uygular:
- Reader A: yeni/fresh ChatGPT review oturumu
- Reader B: yeni/fresh Claude review oturumu

API çağrısı zorunlu değildir. Her oturumda görünen model/ürün kimliği ve tarih kayıt altına alınır.
Okuyucular birbirinin sonucunu ve H19 sonuçlarını görmez.

Her unit için:
- `d1: yes|no|undetermined`
- `d5: yes|no|undetermined`
- `actionable_d5: yes|no|undetermined`
- kısa gerekçe

Actionable D5:
> merge öncesi concurrency/version/locking/serialization/race nedeniyle kod veya hedefli regression-test
> değişikliği ister miydi?

D5 uyuşmazlığında:
- mevcut SHA-bound R1/R2/R0/CI evidence açık ve routine'e bağlanabiliyorsa tie-break evidence olarak kullanılabilir;
- aksi halde `undetermined` kalır.
- H19 sonucu adjudication için açılmaz.

Bu nedenle owner'ın üçüncü model/API çağrısı zorunlu değildir.

## 6. Observed actionable D5

Gerçek mevcut review sürecinden okunur:
- PR reviews
- issue comments
- SHA-bound R0/R1/R2 receipts
- CI/check summaries
- blocker sonrası follow-up diff

`yes` yalnız açık bir D5 blocker/change request routine'e güvenilir biçimde bağlanıyorsa verilir.
Salt D1/idempotency bulgusu D5 değildir.
Eşlenemeyen PR-level artifact `unknown` olur.

## 7. S1 — güvenlik

- D5_INVOLVED recall ≥ %95
- actionable_D5 recall = %100
- observed actionable D5 miss = 0
- D5=no FPR ≤ %35

Bir actionable D5 miss tüm H19s'i düşürür.

## 8. S2 — D1/D5 gerçek trafik

D1_ONLY birimlerde candidate FPR ≤ %30.

Belirsiz mahallede ≥5 D1_ONLY varsa resolver bunların ≥%80'ini no-route etmelidir.
<5 ise insufficient-n, tek başına fail değildir.

## 9. S3 — System Two yük azalması

Baseline %100 unit route.

Candidate:
- route oranı ≤ %85
- yani en az 15 yüzde puan azalma

Ayrıca eligible PR'ların ≥%50'sinde en az bir System Two unit çağrısı kaldırılmış olmalıdır.

**Bu H19s'in ekonomik ana metriğidir.** Dollar fiyat gate'i yoktur. Hedef gerçek işi/call sayısını azaltmaktır.

## 10. S4 — referans etiket güvenilirliği

Ekstra API maliyeti yerine iki bağımsız ürün oturumunun tutarlılığı gate'tir:

- Reader A/B D5 exact agreement ≥ %90
- actionable_d5 exact agreement ≥ %85
- primary D5 etiketi `undetermined` kalan unit oranı ≤ %10

D1 agreement ayrıca raporlanır, gate değildir.

## 11. S5 — dağılım / drift

Eligible-unit sırasını iki yarıya böl:

Her yarıda:
- D5 recall ≥ %90
- route azalması ≥ %10

PR-level bootstrap ile recall ve route-reduction %95 aralıkları raporlanır, gate tuning yapılmaz.

## 12. Maliyet ve latency, ikincil

Primary pass/fail için yeni OpenAI API veya dollar price snapshot gerekmez.

Raporlanır:
- toplam Jev V çağrısı
- resolver çağrısı
- candidate System Two route sayısı
- baseline System Two unit sayısı
- Jev token/latency
- mümkünse mevcut development-engine'in gerçek provider faturası/credit kullanımı

Dollar tasarrufu ancak güvenilir gerçek billing verisi varsa ikincil hesaplanır. Yoksa uydurulmaz.

## 13. Sonuç

H19s yalnız S1+S2+S3+S4+S5 birlikte geçerse başarılıdır.

Geçerse:
- Kepenk adapter v1 freeze
- kalıcı shadow integration
- ücretsiz araç için Experiment Core + adapter packaging
- sonraki araştırma başka repo/domain adapter validasyonu

Kalırsa:
- router production gate olmaz
- aynı trafik üzerinde threshold/prompt tuning yok
- Kepenk adapter router research-only
- yeni harfli sentetik tur yok

## 14. Yasaklar

- H19 ile PR/CI kararını değiştirmek
- reader'a H19 çıktısını göstermek
- sonuçlara göre stop rule değiştirmek
- aynı PR head'lerini ayrı örnek saymak
- aynı kohortta threshold/prompt/router aramak
- post-hoc alt grubu production kapsamına çevirmek
