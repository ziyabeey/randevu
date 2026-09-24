# H19s uygulama eki v1.0 — MÜHÜRLÜ

- **Ana protokol:** `../H19S-PROTOKOL.md` v0.1, commit `c9b6fcaca9a83d7cc8fa1ea162f6e4dd90fd6b59`.
- **Extractor taslağı:** `cikar.mjs`, ilk uygulama commit'i `d6a240b`.
- **Bu ekin amacı:** ana protokolün açık bıraktığı uygulama ayrıntılarını ilk eligible birimden önce sabitlemek.
- **Başlangıç temizliği:** GitHub main geçmişi kontrol edildi; ana protokol zamanından bu ek/pricing mühürlenene kadar `main` üzerinde yeni commit yoktu. Bu nedenle örneklem kaybı yoktur.
- **Shadow:** H19 sonucu PR/CI/merge kararını değiştirmez.

## 1. Birim çıkarımı

`cikar.mjs` tanımı korunur:

- final PR farkı: `merge^1 → merge`;
- `supabase/migrations/**/*.sql`;
- final-effective function/procedure/executable trigger-function gövdesi;
- yorum/boşluk-only değişiklik dışarıda;
- aynı PR içinde aynı rutin tek birim;
- rutin kimliği `schema.name/arity`;
- aynı rutin sonraki başka PR'da değişirse yeni trafik birimi.

### Karar A — yeni rutinler DAHİL

Base'de tanımı olmayan, merge'de yeni executable routine olarak bulunan rutinler eligible unit'tir.

Gerekçe:
- H19s sentetik dağılımı yeniden üretmek için değil, gerçek trafik dağılımında candidate router'ın çalışıp
  çalışmadığını ölçmek için vardır.
- Protokol öncesi kalibrasyonda eligible birimlerin %87'si yeni rutindi; bunları çıkarmak gerçek trafik
  prevalansını yapay biçimde değiştirir.

`new|modified` alanı her birimde kaydedilir ve §12 ikincil raporda zorunlu kırılımdır. Primary gate değildir.
Sonuç yalnız new rutinler tarafından taşınıyorsa bu açıkça raporlanır.

Yeni rutin Jev girdisi:
- `files: [{path, patch}]`;
- patch, tüm yeni routine tanımının eklenen satırlarıdır.

Referans okuyucu paketinde ayrıca `before_definition=null`, `after_definition=<tam rutin>` bulunur.

## 2. Sabit System Two referans okuyucuları

Mevcut R1/R2 Routine endpoint'leri **H19s referans labeler'ı olarak kullanılmaz**. Repository tasarımı gereği bu
rollerin arkasındaki provider/model değiştirilebilir; H19s ise model ve fiyatı dondurmak zorundadır.

İki bağımsız, birbirinin cevabını ve H19 shadow sonucunu görmeyen okuyucu:

### Reader A — primary + maliyet proxy'si

- provider: OpenAI API
- model: `gpt-6-sol`
- reasoning effort: `medium`
- processing: Standard
- araç/web yok
- her eligible unit için tek uncached request
- aynı frozen prompt/schema: `referans-okuyucu.v0.1.json`

Reader A'nın gerçek token usage'ı **birim System Two maliyeti**dir.

### Reader B — bağımsız label kontrolü

- provider: OpenAI API
- model: `gpt-5.6-sol`
- reasoning effort: `medium`
- processing: Standard
- araç/web yok
- her eligible unit için Reader A'dan bağımsız request
- aynı frozen prompt/schema

Reader B yalnız referans etiket güvenilirliği içindir. Reader B maliyeti:
- deney operasyon maliyetinde raporlanır;
- **baseline veya candidate simulated production cost'a dahil edilmez**.

Bu, iki okuyuculu bilimsel etiketleme overhead'inin candidate ekonomisini yapay olarak cezalandırmasını engeller.

### Referans paket

İki okuyucu da yalnız:
- PR numarası ve başlığı;
- routine kimliği/path;
- `new|modified`;
- `patch`;
- `before_definition` (new ise null);
- `after_definition`

görür.

Görmez:
- Jev/V skorları;
- resolver sonucu;
- candidate route;
- mevcut PR review yorumları/CI verdictleri;
- diğer okuyucunun cevabı.

## 3. Referans etiketi ve adjudication

Her okuyucu structured olarak:
- `d1: yes|no|undetermined`
- `d5: yes|no|undetermined`
- `actionable_d5: yes|no|undetermined`
- `reason`

döndürür.

`actionable_d5=yes` şu dar anlama gelir:
> Bu routine değişikliğinde concurrency/version/locking/serialization/race davranışıyla ilgili bir sorun
> nedeniyle reviewer merge öncesi kod veya hedefli regression test değişikliği isterdi.

Sadece "D5 semantiğine dokunuyor" actionable değildir.

### Okuyucu uyuşmazlığı

- D5 aynıysa primary D5 etiketi odur.
- D5 uyuşmazsa veya biri `undetermined` ise H19 sahibi adjudication yapar.
- H19 sahibi adjudication sırasında H19/V/resolver/candidate sonucunu görmez.
- Adjudication paketi iki gerekçeyi + aynı referans paketi içerir.
- H19 sahibi de undetermined bırakırsa birim primary D5 recall/FPR denominator'ından çıkar, fakat örneklem/route
  ve maliyet sayımında kalır; protocol §5'e uygun olarak undetermined oranı ayrıca raporlanır.

Actionable D5 için de iki okuyucu uyuşmazsa aynı kör adjudication uygulanır.

## 4. Baseline ve candidate maliyeti

### Baseline production proxy

```text
baseline_cost =
  sum(Reader A actual token cost for every eligible unit)
```

Reader A aynı zamanda birinci reference labeler olduğu için ayrı bir duplicate System Two baseline çağrısı yapılmaz.

### Candidate simulated production cost

```text
candidate_cost =
  Jev V cost (all eligible units)
+ Jev resolver cost (ambiguous units only)
+ Reader A cost (candidate routed units only)
```

Shadow sırasında Reader A gerçekte bütün birimlerde çalışır. Candidate'ın no-route ettiği birimlerdeki Reader A
çağrısı deneysel counterfactual doğrulama gideridir ve candidate simulated production cost'a girmez.

### Deney overhead'i, primary ekonomi dışında

Ayrıca raporlanır:
- Reader B tüm çağrıları;
- adjudication maliyeti/iş yükü;
- H19 shadow artifact/storage/CI overhead.

Bunlar production candidate maliyetinden ayrıdır.

## 5. Frozen pricing

Fiyatlar `pricing.v0.1.json` dosyasındadır ve ilk eligible birimden önce sabitlenir.

Kurallar:
- USD;
- 1M token birimi;
- gerçek API usage alanları kullanılır;
- Reader promptları 272K altında tutulur;
- Standard processing;
- bölgesel/Fast/Batch fiyatı kullanılmaz;
- deney sırasında liste fiyatı değişirse primary hesap değişmez.

Jev output ücretsiz olduğundan yalnız input token maliyeti hesaplanır.

## 6. Gözlenen actionable D5 kaynağı

Bu metrik reference labeler `actionable_d5` ile **aynı şey değildir**. Var olan geliştirme sürecinde gerçekten
ortaya çıkmış D5 müdahalesini ölçer.

Her sampled PR için merge'den sonra şu **önceden belirlenmiş evidence set** alınır:

1. PR review kayıtları;
2. PR issue comments;
3. SHA-bound development R0/R1/R2 receipt/yorumları;
4. check-run / CI özetleri;
5. bir blocker artifact'ından sonra, merge'den önce gelen follow-up commit diff'leri.

H19 shadow çıktıları bu evidence set'e eklenmez ve mapper'a gösterilmez.

### observed_actionable_D5 = yes

Ancak şu koşulların tamamı varsa:
- merge öncesi bir review/CI artifact'ı açıkça bir **değişiklik** ister veya blocker/failing invariant bildirir;
- neden D5 semantiğidir: race/interleaving, row/advisory lock/serialization/deadlock-order, stale-write/optimistic
  version/CAS, concurrency-safe atomicity veya concurrent request interference;
- artifact routine'i açıkça adlandırır **veya** takip diff'i blocker'ı bu eligible routine'de giderdiğini
  tartışmasız gösterir.

Sadece "idempotency" veya "request hash" D1 bulgusu, concurrency mekanizması açıkça yoksa observed D5 sayılmaz.

### no / unknown

- evidence set'te böyle artifact yoksa: `no`;
- artifact PR düzeyinde olup routine'e güvenilir biçimde eşlenemiyorsa: `unknown`.

`unknown` observed-actionable miss gate'inde olumlu/olumsuz sayılmaz; sayısı raporlanır.

### Mapper

Observed evidence eşlemesi H19 sahibi tarafından, H19 shadow sonucu kapalıyken yapılır.
Bu işlem referans D1/D5 label'larından sonra yapılabilir, fakat candidate route açılmadan tamamlanır.

## 7. Mevcut development review ile ilişki

H19s mevcut development-engine R0/R1/R2 akışını değiştirmez.

- mevcut review PR başına/risk bazlı şekilde normal çalışır;
- H19s Reader A/B birim bazlı **ölçüm okuyucularıdır**, normal merge authority değildir;
- H19s pass olsa bile bu deney tek başına R0/R1/R2 sözleşmesini değiştirmez.

H19s'in ekonomik karşılaştırması "her eligible routine'i System Two ile okumak" baseline'ı ile candidate
unit-router arasındadır. Mevcut PR-level reviewer faturası ikincil gerçek-world context olarak raporlanabilir,
ama primary S4 hesabına karıştırılmaz.

## 8. Örneklem başlangıcı ve zamanlama

Ana protokol commit zamanından bu ek + pricing freeze'e kadar `main` üzerinde yeni commit olmadığı doğrulandı.
Dolayısıyla arada eligible unit yoktur.

**Örneklem başlangıcı**, bu uygulama eki, `pricing.v0.1.json` ve `referans-okuyucu.v0.1.json` birlikte
mühürlendikten sonraki ilk `main` merge'dir.

Bu üç artifact commitlenmeden routine gövdesi değiştiren PR merge edilmez.

Mühürden sonra normal geliştirme devam eder. Örnekleme sonucu görmek için merge durdurulmaz.

## 9. Stop rule

Ana protokol aynen:
- ≥150 eligible unit;
- ≥25 birimli merged PR;
- iki eşiği aşan son PR'ın bütün birimleri dahil;
- sonuç/H19 skoruna göre erken durma veya uzatma yok.

## 10. Değiştirilemez uygulama kararları

H19s başladığında aynı kohortta:
- new rutinleri çıkarma;
- Reader modelini değiştirme;
- reference prompt/schema değiştirme;
- System Two baseline birimini PR'a çevirme;
- pricing değiştirme;
- observed-actionable kaynağını genişletme/daraltma;
- threshold/prompt/router tuning

yasaktır.

Bu ek, ana protokolün geçiş eşiklerini değiştirmez.
