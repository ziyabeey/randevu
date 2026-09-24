# Saat seçimi: tek Choice (v1) ve parça okuma + kod (v2) — 2026-09-24T06:05:00.264Z

Model jev-1.13.0. v1 = sunulan slotlar arasından tek Choice ("hazirlanmis"); v2 = cookbook "Date extraction": 9 parça sorusu tek istekte, eşleştirme kodda, güven = kullanılan parçaların en düşüğü.

| Set | Yöntem | Net doğruluk | Güven ≥ 0.8 oranı | ≥ 0.8 iken doğruluk | Emin ama yanlış (≥ 0.8) | Token/mesaj |
|---|---|---|---|---|---|---|
| 1 | v1 | %85.7 (24/28) | %75.0 | %100.0 | 0 | 688 |
| 1 | v2 | %85.7 (24/28) | %17.9 | %100.0 | 0 | 2625 |
| 2 | v1 | %94.4 (17/18) | %72.2 | %100.0 | 0 | 690 |
| 2 | v2 | %94.4 (17/18) | %11.1 | %100.0 | 0 | 2626 |

## Mesaj bazında

| Set | Mesaj | Beklenen | v1 | v2 | v2 parçaları |
|---|---|---|---|---|---|
| 1 | yarın 3 gibi | s1 | s1 0.94 | s1 0.86 | gün=yarin saat=3 dk=yaklasik dilim=ogleden_sonra istek=belirli |
| 1 | 3'ü biraz geçe | hicbiri/s2 | s2 0.20 | s1 0.52 ❌ | gün=yok saat=3 dk=yaklasik dilim=ogleden_sonra istek=sonra |
| 1 | 4ten önce olsun *(belirsiz)* | s1/s2 | s3 0.17 ❌ | s2 0.49 | gün=yok saat=4 dk=tam dilim=ogleden_sonra istek=once |
| 1 | öğleden sonra | s2 | s2 0.96 | s2 0.37 | gün=yok saat=yok dk=yok dilim=ogleden_sonra istek=belirli |
| 1 | hafta sonu | s3 | s3 0.93 | s3 0.51 | gün=hafta_sonu saat=yok dk=yok dilim=yok istek=belirli |
| 1 | sabah erken | s1 | s1 0.94 | s1 0.58 | gün=yok saat=yok dk=yok dilim=sabah istek=en_erken |
| 1 | işten sonra | s2 | s2 0.96 | s2 0.94 | gün=yok saat=yok dk=yok dilim=aksam istek=sonra |
| 1 | haftaya | s3 | s3 0.61 | s3 0.32 | gün=yok saat=yok dk=yok dilim=yok istek=herhangi |
| 1 | pazartesi olmaz, cuma akşam | s2 | s2 1.00 | s2 0.40 | gün=hafta_gunu:cuma/bu_hafta saat=yok dk=yok dilim=aksam istek=belirli red=pazartesi |
| 1 | bugün olmaz yarın aynı saat | s3 | hicbiri 0.24 ❌ | s2 0.55 ❌ | gün=yarin saat=yok dk=tam dilim=yok istek=belirli red=bugun |
| 1 | en erken hangisi varsa | s1 | s1 0.99 | s1 0.89 | gün=yok saat=yok dk=yok dilim=yok istek=en_erken |
| 1 | öğlen arası *(belirsiz)* | hicbiri/s2 | s2 0.54 | hicbiri 0.82 | gün=yok saat=yok dk=yok dilim=ogle istek=belirli |
| 1 | 2 buçuk | s2 | s2 0.81 | s2 0.34 | gün=yok saat=2 dk=bucuk dilim=yok istek=belirli |
| 1 | iki | s1 | s2 0.73 ❌ | hicbiri 0.20 ❌ | gün=yok saat=2 dk=yok dilim=yok istek=hicbiri |
| 1 | saat 5 olur mu | hicbiri | hicbiri 0.92 | hicbiri 0.42 | gün=yok saat=5 dk=tam dilim=ogleden_sonra istek=belirli |
| 1 | salı | s1 | s1 1.00 | s1 0.60 | gün=hafta_gunu:sali/yok saat=yok dk=yok dilim=yok istek=belirli |
| 1 | çarşamba olmasın da ondan sonraki gün | s3 | s3 0.99 | hicbiri 0.38 ❌ | gün=obur_gun saat=yok dk=yok dilim=yok istek=belirli red=carsamba |
| 1 | ayın 7si | s2 | s2 1.00 | s2 0.69 | gün=ayin_gunu:7 saat=yok dk=yok dilim=yok istek=belirli |
| 1 | akşam 7 | s2 | s2 1.00 | s2 0.91 | gün=yok saat=7 dk=tam dilim=aksam istek=belirli |
| 1 | 7de | s2 | s2 1.00 | s2 0.70 | gün=yok saat=7 dk=tam dilim=aksam istek=belirli |
| 1 | 12 buçukta | hicbiri | hicbiri 0.68 | hicbiri 0.83 | gün=yok saat=12 dk=bucuk dilim=ogle istek=belirli |
| 1 | cumartesi öğleden önce | s1 | s1 0.98 | s1 0.65 | gün=hafta_gunu:cumartesi/yok saat=yok dk=yok dilim=sabah istek=once |
| 1 | pazar | s3 | s3 0.99 | s3 0.59 | gün=hafta_gunu:pazar/yok saat=yok dk=yok dilim=yok istek=belirli |
| 1 | cumartesi hangisi uygunsa *(belirsiz)* | s1/s2 | hicbiri 0.74 ❌ | s1 0.77 | gün=hafta_gunu:cumartesi/yok saat=yok dk=yok dilim=yok istek=herhangi |
| 1 | ne erken ne geç, öğlen | hicbiri | hicbiri 0.93 | hicbiri 0.66 | gün=yok saat=yok dk=yok dilim=ogle istek=belirli |
| 1 | beşe çeyrek kala | s2 | s2 1.00 | s2 0.41 | gün=yok saat=5 dk=ceyrek_kala dilim=ogleden_sonra istek=belirli |
| 1 | dört | s1 | s2 0.22 ❌ | s1 0.49 | gün=yok saat=4 dk=tam dilim=yok istek=belirli |
| 1 | dördü çeyrek geçe | hicbiri | s2 0.76 ❌ | hicbiri 0.40 | gün=yok saat=4 dk=ceyrek_gece dilim=yok istek=belirli |
| 1 | yarın değil bugün | s1 | s1 0.98 | s1 0.70 | gün=bugun saat=yok dk=yok dilim=yok istek=belirli red=yarin |
| 1 | önümüzdeki pazartesi | s1 | s1 0.97 | s1 0.59 | gün=hafta_gunu:pazartesi/gelecek_hafta saat=yok dk=yok dilim=yok istek=belirli |
| 1 | iki hafta sonra pazartesi | s2 | s2 0.91 | s2 0.58 | gün=hafta_gunu:pazartesi/iki_hafta_sonra saat=yok dk=yok dilim=yok istek=belirli |
| 2 | yarın on buçuk | s1 | s1 0.98 | s1 0.64 | gün=yarin saat=10 dk=bucuk dilim=sabah istek=belirli |
| 2 | 11 olsun | s2 | s2 0.97 | s2 0.49 | gün=yok saat=11 dk=tam dilim=sabah istek=belirli |
| 2 | öğleden sonra olur ancak | s3 | s3 0.90 | s3 0.34 | gün=yok saat=yok dk=yok dilim=ogleden_sonra istek=sonra |
| 2 | 10'u çeyrek geçe | hicbiri | hicbiri 0.49 | hicbiri 0.41 | gün=yok saat=10 dk=ceyrek_gece dilim=yok istek=belirli |
| 2 | cumartesi dört buçuk | s2 | s2 0.95 | hicbiri 0.27 ❌ | gün=hafta_gunu:cumartesi/yok saat=15 dk=bucuk dilim=ogleden_sonra istek=belirli |
| 2 | altıya çeyrek var | hicbiri | hicbiri 0.38 | hicbiri 0.54 | gün=yok saat=6 dk=ceyrek_kala dilim=ogleden_sonra istek=belirli |
| 2 | sabah dokuz çok erken *(belirsiz)* | hicbiri/s2 | s2 0.79 | s1 0.66 ❌ | gün=yok saat=9 dk=tam dilim=sabah istek=sonra |
| 2 | bugün akşam | s1 | s1 0.99 | s1 0.64 | gün=bugun saat=yok dk=yok dilim=aksam istek=belirli |
| 2 | yarın akşam | s2 | s2 0.97 | s2 0.83 | gün=yarin saat=yok dk=yok dilim=aksam istek=belirli |
| 2 | haftaya pazartesi | s3 | s3 1.00 | s3 0.61 | gün=hafta_gunu:pazartesi/gelecek_hafta saat=yok dk=yok dilim=yok istek=belirli |
| 2 | hafta sonu | hicbiri | hicbiri 0.70 | hicbiri 0.63 | gün=hafta_sonu saat=yok dk=yok dilim=yok istek=belirli |
| 2 | yarımda | s2 | s2 0.93 | s2 0.52 | gün=yok saat=12 dk=bucuk dilim=ogle istek=belirli |
| 2 | saat birde | s3 | s3 0.97 | s3 0.59 | gün=yok saat=13 dk=tam dilim=ogleden_sonra istek=belirli |
| 2 | öğle yemeğinden sonra, 1 gibi | s3 | s3 0.97 | s3 0.53 | gün=yok saat=1 dk=yaklasik dilim=ogleden_sonra istek=belirli |
| 2 | işten 6'da çıkıyorum | s2 | s2 0.84 | s2 0.67 | gün=yok saat=6 dk=tam dilim=aksam istek=sonra |
| 2 | akşam yedi buçuk | s2 | s2 1.00 | s2 0.92 | gün=yok saat=7 dk=bucuk dilim=aksam istek=belirli |
| 2 | 5 | s1 | s2 0.10 ❌ | s1 0.39 | gün=yok saat=5 dk=tam dilim=yok istek=belirli |
| 2 | gelecek hafta cuma | s1 | s1 0.58 | s1 0.65 | gün=hafta_gunu:cuma/gelecek_hafta saat=yok dk=yok dilim=yok istek=belirli |
| 2 | ayın 16sı | s2 | s2 1.00 | s2 0.73 | gün=ayin_gunu:16 saat=yok dk=yok dilim=yok istek=belirli |
