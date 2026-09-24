# H19s v0.2.1 uygulama açıklamaları — ölçüm öncesi mühür

Bu dosya H19S-PROTOKOL-v0.2'nin eşiklerini veya router'ını değiştirmez. Protokolde açık bırakılmış üç uygulama
noktasını **ilk eligible unit görülmeden** sabitler.

Bu açıklama yazılırken v0.2 kohortunda merge edilmiş PR'lar vardı ancak eligible migration routine birimi **0** idi.
Dolayısıyla aşağıdaki kararlar H19 skoru, gerçek etiket veya eligible unit görülmeden alınmıştır.

## C1 — shadow sonucu ne zaman üretilir?

**Deferred shadow** kullanılır.

Kohort büyürken Jev çağrısı yapılmaz. Yalnız deterministik `cikar.mjs` / `golge.mjs --dry-run` ile:
- merge sırası;
- eligible unit'ler;
- stop-rule durumu

izlenir.

Stop rule sağlanınca sıra:

1. final `kohort.json` dondurulur;
2. `paket.mjs` kör Reader A/B paketlerini üretir;
3. Reader A ve B etiketleri commitlenir;
4. SHA-bound tie-break kanıtı ve `gozlenen.json` commitlenir;
5. **ancak bundan sonra** aynı frozen kohort üzerinde `golge.mjs` Jev V/resolver çağrılarını çalıştırır;
6. `analiz.mjs` etiket + gölge sonuçlarını birleştirir.

Böylece H19 çıktısını ayrı bir dala saklayıp "bakmama" disiplinine ihtiyaç yoktur; referans etiketler
üretilirken H19 sonucu henüz mevcut değildir.

### Model kullanılabilirliği

`jev-1.13.0` shadow çalıştırma anında artık sunulmuyorsa:
- başka Jev/model sürümüne sessiz geçiş yapılmaz;
- H19s v0.2 sonucu üretilemez;
- yeni model için yeni prospective protokol gerekir.

Bu sağlayıcı riski, körlüğü zayıflatmaktan daha kabul edilebilir sayılmıştır.

## C2 — actionable_d5 uyuşmazlığı

Reader A/B `actionable_d5` alanında uyuşmazsa D5 ile aynı kural uygulanır:

- routine'e bağlanmış SHA-bound mevcut R0/R1/R2/CI evidence açık bir cevap veriyorsa `tiebreak.json` kullanılır;
- güvenilir tie-break yoksa `undetermined` kalır;
- H19/V/resolver/candidate route tie-break'e gösterilmez.

## C3 — n = 0 primary gate

Bir **primary oran gate'inin paydası 0 ise gate geçilmiş sayılmaz.**

Durum:
`insufficient-n`

olur. Bu bir threshold failure değildir ama **tam H19s PASS üretmez**.

Uygulandığı primary metrikler:
- D5_INVOLVED recall;
- actionable_D5 recall;
- D5=no FPR;
- D1_ONLY FPR;
- S5'in her yarısındaki D5 recall.

Protokolde açık istisna aynen korunur:
- belirsiz mahallede D1_ONLY sayısı <5 ise resolver alt metriği `insufficient-n` olur ve S2'yi tek başına düşürmez.

`observed actionable D5 miss = 0` bir olay-sayısı kuralıdır; gözlenen `yes` hiç yoksa 0 miss olarak raporlanabilir.
Ancak actionable_D5 referans paydası 0 ise yukarıdaki nedenle S1 yine tam geçmez.

## C4 — sonuç dili

- bütün primary gate'ler ölçülebilir ve geçerse: **PASS**
- en az bir ölçülebilir gate threshold'u ihlal ederse: **FAIL**
- threshold ihlali yok fakat en az bir zorunlu primary gate `insufficient-n` ise: **INSUFFICIENT EVIDENCE**

PASS dışındaki iki durumda router production gate'e terfi etmez.
