# H19d: göreli eksen router testi (ön kayıt)

**Sürüm v0.1, mühürlü.** Bu dosya H19d vaka seti kurulmadan ve hiçbir H19d Jev çağrısı yapılmadan
önce yazılır. Bu commit'ten sonra soru metni, skor tanımı, eşik, kabul kapısı veya vaka seçim kuralı
değişirse yeni protokol sürümü ve tamamen yeni değerlendirme vakaları gerekir (SENTEZ K9).

H19c, H19b′ sonucuna göre kapalı kalır. H19d, H19c'nin devamı değildir; farklı bir hipotezi sınar:
**Jev'in mevcut altı eksenli V çıktısının göreli geometrisi, D5 içeren değişiklikleri ham P(D5)'ten daha
iyi bir System One router sinyaline dönüştürülebilir mi?**

## 0. Önceki veri ve hipotez kaynağı

H19d'den önceki bütün sayılar yalnız hipotez kaynağıdır; kabul kanıtı değildir.

Post-hoc keşif kaydı: `H19D-KESIF.md` / commit `60b4d0b`.
Aynı eski çıktılarda beş varyant denenmiştir; bu yüzden bu tabloda en iyi görünen varyant geriye dönük
"kanıt" sayılmaz.

Önceki üç kaynakta aynı yön görülmüştür:

| Set | ham P(D5) AUC | S0: D5 − max(diğer) | S1: D5 − max(D1 hariç) |
|---|---:|---:|---:|
| H19b′ birincil çapraz | 0.920 | 0.961 | 0.992 |
| H19b′ tümü | 0.927 | 0.979 | 0.987 |
| R0/H19a orijinal 16 | 0.55–0.58 | 0.67–0.68 | 0.73–0.76 |

Aynı veri aynı zamanda ana riski göstermiştir: gerçek D5 başka bir eksenle birlikteyse D5 baskın olmak
zorunda değildir. Örnek R0 C16, gerçek `D4×D5`: D4=.92, D5=.42. Bu nedenle H19d pozitiflerinin
yarısı **D5 + başka eksen** olacaktır ve bu katman için ayrı yakalama kapısı vardır.

## 1. Sabit model ve Jev isteği

- Model: `jev-1.13.0`.
- Jev'e **facts verilmez** (SENTEZ K11).
- DE-JEV-H19-R0 v0.1'in altı bağımsız `noul` eksen sorusu **aynen** kullanılır.
- Jev yön (`weakens/strengthens`) söylemez.
- Jev yalnız şu vektörü üretir:

```text
P = [P(D0), P(D1), P(D2), P(D3), P(D4), P(D5)]
```

Kod bu vektörden aşağıdaki donmuş skorları hesaplar. Model cevabına göre soru değişmez.

## 2. Donmuş skorlar ve router eşikleri

### Baseline V0

```text
B = P(D5)
route_B = B >= 0.50
```

`0.50`, `noul` evet/hayır doğal karar sınırıdır. Baseline kabul adayı değildir; mevcut ham D5
okumasının karşılaştırma noktasıdır.

### Birincil aday S0

```text
S0 = P(D5) - max(P(D0), P(D1), P(D2), P(D3), P(D4))
route_S0 = S0 > 0
```

`τ0 = 0` ölçümden seçilmemiş doğal özgüllük sınırıdır: D5 sinyali en güçlü rakip eksenden yüksekse route.

### İkincil aday S1

```text
S1 = P(D5) - max(P(D0), P(D2), P(D3), P(D4))
route_S1 = S1 > 0
```

D1, H19a/H19b′ verisindeki transaction/eşzamanlılık komşuluğu nedeniyle rakip havuzundan çıkarılır.
**S1 post-hoc adaydır.** H19d değerlendirme setinde S0'dan daha iyi çıksa bile aynı set üzerinden
S0'ın yerine üretim adayı yapılamaz.

- S0, H19d'nin **tek birincil adayıdır**.
- S1'in bütün metrikleri önceden adlandırılmış ikincil sonuç olarak raporlanır.
- Rank, logit-marj, ağırlıklı toplam, eşik taraması veya başka formül H19d sonucuna eklenmez.
- Ölçümden sonra `τ0` veya `τ1` ayarlanmaz.

## 3. Hedef etiket

H19d'nin pozitif etiketi:

> Değişiklik D5 (eşzamanlılık / optimistic version / serialization) davranışını maddi olarak etkiliyor mu?

Pozitif bir vaka D5'in tek eksen olduğu bir değişiklik olabilir **veya** D5 ile başka bir ekseni birlikte
değiştirebilir. D5'in baskın eksen olması gerekmez.

Negatif vaka D5'i maddi olarak değiştirmez; başka eksenleri gerçekten değiştirmelidir. Salt mesaj,
formatlama veya anlamsız no-op negatifleri ana değerlendirmeye alınmaz.

Yön bu deneyin etiketi değildir. Yön ve neden gerektiğinde System Two'nun işidir.

## 4. Yeni değerlendirme seti: 80 vaka

Tamamen yeni **80 mutasyon**: 40 gerçek D5, 40 D5 değil.

### Pozitifler: 40

**P-single, 20 vaka**
- D5 maddi olarak değişir; hedeflenen ana semantik eksen yalnız D5'tir.
- 10 korumayı zayıflatan, 10 güçlendiren değişiklik. Yön yalnız set çeşitliliği için tutulur; Jev'e
  direction sorulmaz.

**P-pair, 20 vaka**
- D5 ile başka bir H19 ekseni birlikte maddi olarak değişir.
- Tam dağılım:
  - 4 × D0×D5
  - 4 × D1×D5
  - 4 × D2×D5
  - 4 × D3×D5
  - 4 × D4×D5
- Her çiftte mümkünse 2 zayıflatma + 2 güçlendirme bulunur.
- D5'in Jev çıktısında diğer eksenden yüksek olması **vaka seçim şartı değildir**. Model çağrısı zaten
  freeze sonrasıdır; vaka üreticisi bunu bilemez.

### Negatifler: 40

**N-single, 20 vaka**
- D5 değişmez; tam dağılım 4'er vaka D0, D1, D2, D3, D4.
- Eksendeki değişiklik maddi olmalıdır.

**N-pair, 20 vaka**
- D5 değişmez; D0–D4 arasındaki 10 olası çiftten **ikişer vaka**.
- İki eksenin ikisi de maddi olarak değişmelidir.

Bu matris, göreli skorun yalnız "tek eksenli pozitif / çok eksenli negatif" kolaylığından yararlanmasını
engeller.

## 5. Vaka kaynağı ve tekrar yasağı

- Kaynak gerçek `supabase/migrations` fonksiyonları ve gerekirse aynı fonksiyonların eski, gerçek migration
  sürümleridir.
- Mutasyonlar küçük, insan tarafından okunabilir ve gerçek semantik davranışı değiştiren değişikliklerdir.
- R0/H19a, H19b ve H19b′'deki **aynı mutasyon** yeniden kullanılamaz.
- Aynı üretim fonksiyonu yeni bir mutasyonla yeniden kullanılabilir; `function_reused` alanıyla işaretlenir.
- Her vaka için ölçümden önce:
  - D5 var/yok;
  - varsa single/pair ve eş eksen;
  - yoksa gerçek eksen veya eksen çifti;
  - yön (yalnız çeşitlilik kaydı);
  - gerekçe;
  - aile etiketi
  yazılır.

## 6. İpucu ve yapısal dengeleme

H19a lexical prior'ını yeniden kolaylaştırmamak için, model çağrısından önce set üzerinde aşağıdaki
betimleyici alanlar hesaplanır fakat **Jev girdisine verilmez**:

- `lock_context` (H19b'nin donmuş tanımı);
- diff'te H19a ipucu sözlüğü:
  `/for update|lock|version|advisory|serializ|skip locked|nowait/i`;
- eklenen/silinen satır sayısı;
- değişen toplam satır;
- silinen `where/and` satırı;
- eklenen `exists/select`;
- removed-predicate ailesi.

Denge kuralı:
- Pozitif ve negatif gruplarda `lock_context=true` sayısı arasındaki fark **en fazla 4**.
- Pozitif ve negatif gruplarda ipucu bulunan vaka sayısı arasındaki fark **en fazla 4**.
- P-single / P-pair / N-single / N-pair katmanlarının hiçbiri yalnız bir function family tarafından
  çoğunlukla temsil edilemez; tek aile en fazla %50.

## 7. Naif özellik kapısı: model çağrısından önce

Aşağıdaki her tek özellik için D5 pozitif vs negatif AUC hesaplanır:

- diff boyutu;
- eklenen satır;
- silinen satır;
- silinen `where/and`;
- cue var/yok;
- `lock_context`;
- removed-predicate var/yok.

Aynı özellikler P-pair ile N-pair arasında ayrıca ölçülür.

**Freeze şartı:** herhangi bir tek özellik
- genel pozitif/negatifte AUC > 0.70
- veya P-pair/N-pair'de AUC > 0.70

verirse set dondurulmaz. Hiç Jev çağrısı yapılmadan yeniden dengelenir.

Vaka seti ancak bütün kapılar geçtikten sonra JSON + SHA-256 ile freeze edilir.

## 8. Kör ikinci okuyucu

Freeze sonrası, Jev çağrısından önce sabit tohumla **16 vaka**:

- 4 P-single;
- 4 P-pair (D5 eş eksenleri mümkün olduğunca farklı);
- 4 N-single;
- 4 N-pair.

İkinci okuyucuya hücre/etiket gösterilmez. Her vaka için:
1. D5 maddi olarak etkileniyor mu? `yes/no/undetermined`
2. etkileniyorsa diğer maddi eksen(ler);
3. etkilenmiyorsa maddi eksen(ler)

yazılır.

Anahtar ayrı dosyadadır. Uyuşmazlıkta etiket değiştirilmez:
- vaka değerlendirmeden düşer;
- önceden tanımlı eşlenmiş çifti varsa o da paired analizden düşer;
- vaka yenisiyle doldurulmaz.

Kör cevap commit'i ilk H19d Jev çağrısından önce olmalıdır.

## 9. Çalıştırma

Aynı dondurulmuş 80 vakada iki bağımsız, önbelleksiz V turu:

- **V1**: birincil;
- **V2**: yalnız kararlılık.

Toplam **160 Jev çağrısı**.

Her kayıt:
- model sürümü;
- soru-bankası sürümü;
- vaka hash'i;
- input digest;
- altı eksen olasılığı;
- token;
- gecikme
taşır.

Analiz scripti V1 çalışmadan önce commit'lenir.

## 10. Birincil araştırma metriği: göreli matematik gerçekten ek bilgi taşıyor mu?

V1 üzerinde:

- `AUC_B = AUC(P(D5))`
- `AUC_S0 = AUC(S0)`

### Gate D1 — prospective göreli-skor katkısı

Üçü de gerekir:

1. `AUC_S0 >= 0.80`
2. `AUC_S0 - AUC_B >= +0.05`
3. Vaka kimliği üzerinden 10,000 tekrar, sabit tohumlu paired bootstrap ile
   `AUC_S0 - AUC_B` %95 güven aralığının alt sınırı **> 0**

Ek olarak ayrı raporlanır:
- P-single vs tüm negatifler AUC;
- P-pair vs tüm negatifler AUC;
- P-pair vs N-pair AUC.

P-pair vs N-pair AUC < 0.70 ise D1 geçse bile "çift eksenli D5'e genelleniyor" iddiası yapılamaz.

## 11. Gerçek dispatcher kapısı: sabit eşik

AUC router değildir. V1 üzerinde donmuş karar:

```text
route_S0 := S0 > 0
```

hesaplanır.

### Gate D2 — operasyonel router

Tamamı gerekir:

- **genel D5 yakalama (TPR) >= %90**
- **P-single TPR >= %90**
- **P-pair TPR >= %85**
- **genel yanlış alarm (FPR) <= %25**
- **N-pair FPR <= %30**

Wilson %95 aralıkları raporlanır ama kapı point estimate üzerindedir; örneklem boyutu bu alt gruplarda
CI-alt-sınır kapısı için yetersizdir.

### Baseline karşılaştırması

Aynı vakalarda `route_B := P(D5) >= 0.50` için TPR/FPR aynı şekilde raporlanır.

S0 router'ı, baseline tarafından **strictly dominated** ise D2 kalır:
- baseline TPR >= S0 TPR;
- baseline FPR <= S0 FPR;
- ve en az biri strict.

Böylece göreli matematik sırf AUC iyi diye daha kötü bir gerçek router olarak terfi edemez.

## 12. Katman dayanıklılığı

D2 metrikleri ayrıca şu alt gruplarda raporlanır:

- `lock_context=true/false`;
- lexical cue var/yok;
- D5 eş ekseni D0/D1/D2/D3/D4;
- negatif D0/D1/D2/D3/D4;
- single/pair.

### Gate D3 — tek bir bağlama bağımlı olmama

- cue-present ve cue-free pozitiflerde TPR'nin her biri >= %80;
- lock-context true ve false pozitiflerde TPR'nin her biri >= %80;
- hiçbir tek negatif eksen grubunda FPR > %50.

Bu gate, H19a'daki bir sözcük veya bağlam prior'ının yeni router'ı taşımasını engeller.

## 13. Kararlılık

V2 aynı 80 vakada bağımsız uncached turdur.

### Gate D4

S0 için:
- `mean |S0_V1 - S0_V2| <= 0.05`;
- `route_S0` karar uyumu >= %90;
- V2 `AUC_S0`, V1'den 0.10'dan fazla düşmez;
- V2 genel TPR, V1'den 10 yüzde puandan fazla düşmez;
- V2 genel FPR, V1'den 10 yüzde puandan fazla yükselmez.

## 14. İkincil S1 kuralı

S1 için D1–D4'ün **aynı metrikleri ve aynı eşikleri** hesaplanır, fakat sonuç kuralı farklıdır:

- S1, H19d setinde S0'dan daha iyi olduğu için aynı set üzerinde seçilemez.
- S0 bütün kapıları geçse bile üretim adayı S0 olarak kalır.
- S0 kalır, S1 bütün eşikleri geçerse sonuç yalnız:
  **"D1-excluded score prospectively promising; bağımsız yeni doğrulama gerekir."**
- S1 için promosyon ancak aynı formül ve eşikle yazılmış ayrı H19d-R2 ön kaydı + tamamen yeni set geçerse
  düşünülebilir.
- S1 başarısı H19d birincil sonucunu kurtarmaz.

## 15. Yön ve System Two

H19d yön tahmini yapmaz.

Mimari hedef:

```text
diff
  ↓
Jev V: D0..D5 olasılık vektörü (facts yok)
  ↓
kod: S0 + sabit eşik
  ↓
route / no-route
  ↓ route
System Two: hangi garanti değişti, yön ne, neden?
```

System Two'nun yön doğruluğu H19d kapsamı dışındadır ve H19d geçerse ayrı ön kayıtla ölçülür.

## 16. Sonuç kuralı

**H19d başarılı** sayılması için D1 + D2 + D3 + D4'ün tamamı geçmelidir.

Geçerse desteklenen dar iddia:

> Yeni, dengeli ve çift-eksen D5 vakaları içeren prospective sette, altı-eksen Jev vektörünün önceden
> tanımlanmış S0 göreli skoru ham P(D5)'e ek ayrıştırma sağladı ve sabit τ=0 ile yüksek-yakalama /
> sınırlı-yanlış-alarm System One router'ı olarak çalıştı.

Bu sonuç:
- H19'un genel matematik teorisini kanıtlamaz;
- D5'in yönünü çözmez;
- üretimde otomatik karar yetkisi vermez.

D1 geçer ama D2 kalırsa:
- göreli matematik **ranker olarak desteklenir**;
- dispatcher olarak desteklenmez;
- eşik aynı veri üzerinde yeniden ayarlanmaz.

D2 geçer ama D1 kalırsa:
- router çalışmış olabilir fakat göreli skorun ham D5'e ek değer sağladığı gösterilmemiştir;
- mevcut baseline korunur.

Herhangi bir gate kalırsa üretim/shadow promosyonu yoktur.

Bütün kapılar geçerse **H19e** açılabilir: gerçek geliştirme akışında yalnız gölge modda V+S0 router'ın
System Two çağrı yükü ve kaçırdığı vakalar ölçülür. H19c kapalı kalır.

## 17. Kapsam dışı / yasaklar

- H19d setinde eşik taraması yok.
- Ölçümden sonra score formülü değiştirmek yok.
- Rank veya yeni bir üçüncü aday eklemek yok.
- Facts'i Jev'e koymak yok.
- Jev'den yön istemek yok.
- H19d sonucuna bakıp aynı set üzerinde D1'i ekleyip/çıkarmak, ağırlık öğrenmek veya logistic regression
  fit etmek yok.
- Dispatcher/CI/üretim motoru H19d geçmeden değiştirilmez.
