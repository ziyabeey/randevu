# H19t: ham D5 çalışma noktası testi (ön kayıt)

**Sürüm v0.1, mühürlü.** Bu dosya H19t vaka seti kurulmadan ve hiçbir H19t Jev çağrısı yapılmadan
önce yazılır. Bu commit'ten sonra eşik, soru, vaka seçim kuralı veya kabul kapısı değiştirilirse yeni
protokol sürümü ve tamamen yeni değerlendirme vakaları gerekir (SENTEZ K9).

H19d sonucu göreli eksen router'ını desteklemedi. H19t yeni matematik aramaz. Tek soru şudur:

> Altı eksenli V isteğinin ham `P(D5)` sinyali için, geçmiş prospective veriden önceden sabitlenmiş bir
> eşik yeni vakalarda yüksek yakalama oranını korurken System Two'ya giden gereksiz çağrıları anlamlı
> ölçüde azaltıyor mu?

H19c ve H19e kapalı kalır. H19t ayrı bir çalışma-noktası doğrulamasıdır.

## 0. Eşik nasıl seçildi

Eşik H19t setinden seçilmez. Yalnız daha önce tamamlanmış üç prospective set kalibrasyon verisidir:

- H19b
- H19b′
- H19d V1

Donmuş seçim kuralı:

> Bu üç setin **her birinde ayrı ayrı en az %90 D5 recall** bırakan gözlenmiş `P(D5)` değerleri arasından
> en yüksek eşiği seç.

Bu kural tekil olarak:

```text
τ = 0.64
route_T := P(D5) >= 0.64
```

verir.

Kalibrasyon kaydı:

| Eski prospective set | τ=.64 recall | τ=.64 FPR |
|---|---:|---:|
| H19b | 19/20 = %95.0 | 10/30 = %33.3 |
| H19b′ | 29/32 = %90.6 | 6/32 = %18.8 |
| H19d | 39/40 = %97.5 | 18/40 = %45.0 |

`τ=.65` seçilemezdi: H19b′ recall 28/32 = %87.5'e düşer.

Bu tablo **kalibrasyondur, doğrulama değildir**. H19t sonucu yalnız tamamen yeni vakalardan gelir.
Ölçümden sonra eşik taraması yasaktır.

## 1. Sabit model ve soru

- Model: `jev-1.13.0`.
- Soru bankası: DE-JEV-H19-R0 v0.1'in altı bağımsız `noul` eksen sorusu, aynen.
- Facts yok.
- Direction sorusu yok.
- Model yalnız `P(D0)..P(D5)` üretir.
- Router yalnız `P(D5)` okur.

Birincil router:

```text
route_T := P(D5) >= 0.64
```

Karşılaştırma baseline'ı:

```text
route_B := P(D5) >= 0.50
```

Başka eşik veya skor H19t sonucunda hesaplanmaz. AUC yalnız tanısal rapordur, eşik seçmek için kullanılmaz.

## 2. Yeni set: 80 vaka

H19d ile aynı semantik zorluk matrisi, fakat **80 yeni mutasyon**:

| Katman | n | İçerik |
|---|---:|---|
| PS | 20 | yalnız D5; 10 weakens + 10 strengthens |
| PP | 20 | D5 + başka eksen; D0×D5...D4×D5, her biri 4 |
| NS | 20 | D5 değil; D0...D4, her biri 4 |
| NP | 20 | D5 değil; D0–D4 arasındaki 10 çift, her biri 2 |

Yön yalnız çeşitlilik kaydıdır; model direction üretmez.

### Tekrar yasağı

- R0/H19a, H19b, H19b′ ve H19d'deki **aynı mutasyon** yeniden kullanılamaz.
- Aynı fonksiyon yeni bir mutasyonla kullanılabilir, ancak `function_reused` olarak işaretlenir.
- Her katmanda tek bir function family en fazla %50 olabilir.

## 3. Denge ve naif özellik kapısı

H19a lexical/context prior'ının seti taşımasını engellemek için model çağrısından önce:

- `lock_context`;
- diff/yol üzerinde `/for update|lock|version|advisory|serializ|skip locked|nowait/i`;
- eklenen/silinen/değişen satır sayısı;
- silinen `where/and`;
- added `exists/select`;
- removed-predicate

hesaplanır, fakat Jev girdisine verilmez.

Denge:
- pozitif/negatif `lock_context=true` sayısı farkı ≤ 4;
- pozitif/negatif cue sayısı farkı ≤ 4;
- PS/PP/NS/NP katmanlarında tek function family payı ≤ %50.

Freeze öncesi her tek naif özellik için:
- tüm pozitif vs negatif;
- PP vs NP

AUC hesaplanır.

Herhangi biri **> 0.70** ise set dondurulmaz. Vaka seti hiçbir model çağrısı yapılmadan yeniden dengelenir.

## 4. Kör ikinci okuyucu

Freeze sonrası, ilk Jev çağrısından önce sabit tohumla 16 vaka:

- 4 PS
- 4 PP
- 4 NS
- 4 NP

İkinci okuyucu yalnız diff ve gerektiğinde fonksiyon bağlamını görür. Her vaka için:
1. D5 maddi olarak etkileniyor mu: `yes/no/undetermined`
2. diğer maddi eksen(ler)

yazar.

Anahtar ayrı dosyadadır. Uyuşmazlıkta vaka yeniden etiketlenmez, değerlendirmeden düşer. Kör cevap
commit'i ilk H19t çağrısından önce olmalıdır.

## 5. Çalıştırma

Aynı dondurulmuş vakalarda iki bağımsız uncached tur:

- V1: birincil
- V2: kararlılık

Toplam 160 Jev çağrısı (düşen vaka yoksa).

Her kayıt model sürümü, soru-bankası sürümü/hash'i, vaka hash'i, input digest, altı eksen olasılığı,
token ve latency taşır.

Analiz scripti V1 başlamadan önce commit'lenir.

## 6. Birincil operasyonel kapılar

### T1 — yakalama

V1, `τ=.64`:

- genel D5 TPR ≥ **%90**
- PS TPR ≥ **%90**
- PP TPR ≥ **%85**
- PP içindeki D0×D5, D1×D5, D2×D5, D3×D5, D4×D5 gruplarının hiçbirinde TPR < **%75**

System One'ın işi "şuraya bak" olduğu için recall birincil güvenlik metriğidir.

### T2 — yanlış alarm / System Two yükü

V1, `τ=.64`:

- genel FPR ≤ **%35**
- NP FPR ≤ **%35**
- hiçbir tek negatif eksen grubunda (D0...D4 içeren) FPR > **%60**

Ek operasyonel şart:

- `route_T` toplam route oranını `route_B`'ye göre en az **10 yüzde puan** azaltmalı.

Bu son madde, yeni eşik recall'ı korusa bile System Two yükünde anlamlı tasarruf sağlamıyorsa terfiyi engeller.

### T3 — baseline'a göre trade-off

Aynı V1 vakalarında `τ=.50` baseline raporlanır.

`τ=.64` için:
- genel TPR kaybı baseline'a göre en fazla **10 yüzde puan**;
- PP TPR kaybı en fazla **15 yüzde puan**;
- genel FPR, baseline'dan en az **10 yüzde puan daha düşük** olmalı.

T1–T3 birlikte, "daha az çağrı karşılığında kabul edilebilir recall kaybı" hipotezini sınar.

## 7. Bağlam dayanıklılığı

V1 `τ=.64`:

### T4

- cue-present pozitif TPR ≥ %85
- cue-free pozitif TPR ≥ %85
- lock-context=true pozitif TPR ≥ %85
- lock-context=false pozitif TPR ≥ %85
- cue-present negatif FPR ≤ %45
- cue-free negatif FPR ≤ %45

Bu kapı çalışma noktasının H19a'daki tek bir lexical/context prior'a yaslanmasını engeller.

## 8. Tur kararlılığı

### T5

V1 ↔ V2:

- ort. `|P(D5)_V1 - P(D5)_V2| <= 0.05`
- `route_T` karar uyumu ≥ %90
- V2 genel TPR, V1'den >10 yüzde puan düşmez
- V2 genel FPR, V1'den >10 yüzde puan yükselmez
- V2 PP TPR, V1'den >15 yüzde puan düşmez

## 9. İkincil raporlar, eşiksiz

Aşağıdakiler raporlanır fakat yeni gate veya eşik üretmez:

- ham P(D5) AUC;
- P(D5) dağılımı PS/PP/NS/NP;
- D5×D0...D5×D4 TPR;
- negatif D0...D4 FPR;
- cue/lock-context katmanları;
- removed-predicate ve diğer önceden işaretli aileler;
- token ve latency;
- Wilson %95 aralıkları;
- `τ=.50` ve `τ=.64` için precision yalnız dengeli test prevalansı bağlamında (üretim prevalansı olarak yorumlanmaz).

## 10. Sonuç kuralı

**H19t geçer** yalnız T1 + T2 + T3 + T4 + T5'in tamamı geçerse.

Desteklenen dar iddia:

> Önceden yalnız geçmiş prospective setlerden kalibre edilen sabit `P(D5)>=0.64` çalışma noktası,
> tamamen yeni ve çift-eksen D5 vakaları içeren dengeli sette yüksek D5 yakalama oranını korurken
> `0.50` baseline'a göre System Two yönlendirme yükünü anlamlı biçimde azalttı.

Geçerse açılan sonraki adım **H19s**'dir:
- gerçek geliştirme akışında yalnız shadow;
- otomatik karar yok;
- route edilen ve kaçırılan vakalar insan/System Two sonucu ile karşılaştırılır;
- gerçek prevalans ve gerçek çağrı maliyeti ölçülür.

Herhangi bir gate kalırsa:
- `τ=.64` terfi etmez;
- aynı H19t setinde yeni eşik aranmaz;
- raw P(D5) yalnız iyi bir sıralayıcı olarak kalır;
- H19s açılmaz.

## 11. Kapsam dışı / yasaklar

- H19t setinde threshold sweep yok.
- ROC/PR eğrisinden yeni çalışma noktası seçmek yok.
- S0/S1, rank, logit veya başka relative-axis skorunu yeniden açmak yok.
- Facts'i Jev'e koymak yok.
- Direction istemek yok.
- H19t sonucuna göre aynı sette `τ` değiştirmek yok.
- Üretim/CI/dispatcher H19t geçmeden değiştirilmez.
