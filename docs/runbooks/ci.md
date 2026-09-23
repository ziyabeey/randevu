# CI ve main birleşme kontrolü

S06 uygulaması; güncel kabul ve açık erişim işi [S06 devrinde](../handoffs/S06.md) ve [TASKS](../../TASKS.md) içindedir. Bu dosyanın veya JSON'un Git'e eklenmesi GitHub ayarını etkinleştirmez.

## Çalışma yolu

CI her kaynak/hedef branch'teki PR ve main push için çalışır. Böylece üst üste kurulan PR'lar da main'e alınmadan test edilebilir. Workflow düzeyinde dosya filtresi yoktur; tek ve koşulsuz job olan `CI gate` sabit sonuçtur. Aynı PR'a yeni commit eski run'ı iptal eder; farklı PR ve staging koşularına dokunmaz. CI secrets/deploy/admin yetkisi kullanmaz; checkout credential'ı saklanmaz.

`ci-scope.mjs` PR merge-base/head veya push before/after arasındaki bütün yolları NUL ayrımlı Git diff ile okur. Yalnız izinli kök Markdown dosyaları ve `docs/**/*.md` belge kolu carry-forward için uygundur. Silinen dosya ve rename'in iki tarafı dahildir. Her PR olayında workflow hiçbir GitHub tokenı kullanmadan public Actions metadata'sından yalnız authoritative `.github/workflows/ci.yml` SUCCESS run'larını okur; bir receipt ancak aynı PR'a aitse ve o run'ın `CI gate` job'unda `Run all required code checks` ile aggregate sonuç adımları gerçekten SUCCESS ise tam-kod adayı sayılır. Base SHA geçmiş workflow metadata'sından alınmaz: `ci-scope.mjs` git graph üzerinden hem güncel base'in receipt head'in ancestor'ı olduğunu hem de receipt head'in current head'in ancestor'ı olduğunu doğrular. Bu iki lineage kanıtı geçerse ve receipt head → current head deltası yalnız izinli Markdown ise tam kod kanıtı taşınır; aksi durumda full CI fail-closed çalışır. Böylece main sonradan ilerlediğinde eski green receipt otomatik geçersizleşir. Yeni standalone docs-only PR da güncel `main` base SHA’sına ait başarılı push CI gate (belge ve aggregate adımları success; code adımı success veya izinli docs skip) varsa ve bu base current head’in ancestor’ıysa `green-main-docs-only` yolunu kullanır. Base/main kimliği, diff veya CI kanıtı eksikse full CI çalışır. PR full-code receipt’i ile main push gate receipt’i ayrı origin taşır; docs-only main receipt code candidate’ın full-code kanıtı yerine geçemez. Yeni bir dosya türü kendiliğinden hafif sayılmaz.

| Yol | Çalışan işler | Kurulum / typecheck / PG17 |
| --- | --- | --- |
| Yalnız izinli belge | CI gate: belge kontrolü ve sonuç | 0 / 0 / 0 |
| Green current-main base + yalnız izinli belge PR’ı | Main push gate receipt’i + current belge/görev grafiği kontrolü | 0 / 0 / 0 |
| Aynı-base exact-head green candidate'ın yalnız belge descendant'ı | Önceki tam kod receipt'i carry-forward + current belge/görev grafiği kontrolü | 0 / 0 / 0 |
| Kod, migration, CI, karma, receipt/lineage belirsizliği | CI gate: belge + tam kod kontrolleri ve sonuç | 1 / 1 / 1 |

Belge doğrulayıcı Git'te izlenen Markdown'ın yerel linklerini, TASKS bağımlılıklarını/döngülerini/durumlarını, faz kapılarını ve mevcut durumdaki açık S-görev beyanlarını denetler. Tarihsel devir metni güncel durum gibi yorumlanmaz. Harici URL erişilebilirliği ve bölüm anchor'ları ağ taramasıyla doğrulanmaz.

Tam kolun tek yürütücüsü `scripts/ci-code.mjs` şu sırayı uygular: çalıştırılabilir envanter, high/critical bağımlılık denetimi, typecheck, default build, Chrome smoke, Worker dry-run, recursive Node testleri, staging build, PostgreSQL planı ve S05 gerçek psql bağlantı testi. Default build'in smoke/dry-run kontrolü staging build'den önce kalır. PostgreSQL 17 yalnız kod kolunda, job'a ait atılabilir Docker container ile localhost portunda başlar; readiness en fazla 30 tur bekler, cleanup hata/iptalde de denenir. Sonuç ancak bütün alt süreçler başarılıysa `complete=true` üretir. Belge doğrulayıcısının ayrıca tamamlanma çıktısı vardır. Son aggregate adımı `always()` ile önceki adımların gerçek sonuçlarını/çıktılarını denetler. Sonuç/kol/çıktı eşleşmezse, zorunlu kontrol eksik/iptal/atlandıysa kırılır. Job koşulsuzdur; kod adımlarının beklenen şekilde atlanması tüm job'ı skipped yapmaz.

## Katkıda bulunurken

- Belge: `npm run test:docs` (npm kurulumu gerektirmeyen karşılığı `node scripts/ci-docs.mjs`). Yeni dosyaları Git'e ekle; çalışma dizininde olup izlenmeyen link hedefi geçmez.
- Kod: `npm ci`, `npm run typecheck`, `npm run build`, ilgili davranış testleri. Yerel `build` ve `build:staging` kendi typecheck korumasını sürdürür. `build:ci` / `build:staging:ci` yalnız öncesinde typecheck çalıştıran CI içindir.
- Yeni SQL dosyası: normal migration/acceptance testleri için `scripts/ci-postgres-plan.json` içine doğru database ve upgrade aşamasında gerçek adımı ekle. **Kalıcı H19 interaction regression senaryosu ayrı plan adımı açmaz**; tek repo-level `supabase/tests/h19_integrity_gate.sql` içinde manifest kaydı (`h19_expect`), scenario include (`\\ir`) ve pass kaydı (`h19_pass`) ile tanımlanır. `h19_assert_complete` kayıtlı senaryo sayısı ile geçen senaryoların birebir eşleşmesini zorlar. Gate, kayıtlı senaryoların ihtiyaç duyduğu en geç kabul edilmiş şema aşamasından sonra konumlanır. `npm run test:ci-coverage` çalıştır. Yalnız YAML yorumuna isim eklemek geçmez. Birleştirilmiş migration içeriği değişmez.
- Yeni Node testi: `tests/` altında `.test.mjs`; alt dizinler dahil gerçek runner keşfeder. Elle wildcard veya ayrı isim listesi tutulmaz.
- SQL yerel tam çalıştırma yalnız **atılabilir test PostgreSQL 17** üzerinde yapılır; plan `yzt_upgrade` ve `yzt_s03_upgrade` test DB'lerini yeniden oluşturur. Hosted Supabase/staging/production bağlantısı verilmez.
- Herhangi bir CI altyapısı değişimi aynı PR'ın kod incelemesine tabidir. Repo içindeki testler, kendi dosyalarının kasıtlı değiştirilmesine karşı harici güvenlik sınırı değildir; bu değişikliklerde bağımsız ajan incelemesi ve kanıt kaydı proje protokolünde sürer. Tek kişilik GitHub hesabında bu inceleme ayrı bir insan onayı olarak zorlanmaz.

## Main kural paketi — yöneticiye hazır

[main-ruleset.json](../../.github/main-ruleset.json) kullanıcı tarafından 13 Eylül 2026'da onaylanan tek kişilik repo düzenidir. Main'e değişiklik PR üzerinden gelir; güncel base üzerinde GitHub Actions kaynaklı **CI gate** başarılı olmalıdır. İnceleme konuşmaları çözülür; force-push ve silme engellenir, bypass listesi boştur. GitHub Actions app ID `15368` gerçek check-run kaydından doğrulanmıştır.

| Ayar | Onaylanan değer |
| --- | --- |
| GitHub'da zorunlu insan onayı | `required_approving_review_count: 0` |
| Son push yapan dışında onay | `require_last_push_approval: false` |
| PR üzerinden değişiklik | Zorunlu |
| Güncel base üzerinde CI | `CI gate`, strict, GitHub Actions `15368` |
| Çözülmüş inceleme konuşmaları | Zorunlu |
| Bypass / force-push / main silme | Bypass yok; force-push ve silme engelli |

Önceki ikinci yetkili GitHub hesabı önkoşulu, kullanıcının açık onayıyla kaldırıldı. Sol ve koordinatörün bağımsız kod incelemesi, bulguları ve test kanıtı PR/devirde tutulmaya devam eder. Bu süreç GitHub'ın başka insan hesabından approval kontrolü değildir; hesap sahibi yeşil PR'ı tek hesabıyla birleştirebilir. Kod incelemesi protokolü korunur.

Repo sahibi `Settings → Rules → Rulesets → New ruleset → Import a ruleset` üzerinden JSON'u içe aktarabilir. Yetkili yönetici CLI alternatifi (değerler secret içermez):

```bash
gh api --method POST repos/ziyabeey/randevu/rulesets --input .github/main-ruleset.json
```

Aynı kural varsa ikinci kez oluşturma; mevcut ID'nin ayarını karşılaştırıp güncelle. Yönetici erişimi bağlı uygulamada yoktur; ilk branch-protection okuması `403 Resource not accessible by integration` döndü. Repo sahibinin kurulumu sonrası 13 Eylül 2026'da [23159972 numaralı ruleset](https://github.com/ziyabeey/randevu/rules/23159972) etkin ve main `protected:true` doğrulandı. Kapsam main, bypass yok, insan onayı 0, last-push approval false, konuşma çözümü ve strict CI gate / Actions 15368 zorunludur. Koruma ruleset ile sağlandığından eski branch-protection alanlarının boş olması korumasızlık anlamına gelmez.

Uygulamadan sonra geri oku:

```bash
gh api repos/ziyabeey/randevu/rulesets
gh api repos/ziyabeey/randevu/rules/branches/main
gh api repos/ziyabeey/randevu/pulls/PR_NUMBER
gh api repos/ziyabeey/randevu/commits/HEAD_SHA/check-runs
```

Aktif main kapsamı, bypass yokluğu, insan onayı sayısı 0, son-push approval false ve strict required `CI gate`/GitHub Actions kaynağı doğrulanır. PR'ın güncel head/merge sonucu ile bağımsız ajan inceleme kaydı birlikte değerlendirilir. Yeşil eski commit yeterli değildir. Başarısız veya eksik CI birleşmeyi engellemelidir; başka insan hesabının bulunmaması engel değildir. Aktif koruma ve güncel CI doğrulanmadan S06 tamamlanmış sayılmaz.

## Maliyet kanıtının sınırı

Belge kolunda npm kurulumu ve DB container yoktur; kod kolunda üç typecheck bir olur. İlk üç-job tasarımında 81 runner-saniyesi ve 4 yuvarlanmış dakika, eski tek-job 63 saniye/2 dakikaya göre gereksiz ek yük gösterdi. Bu ölçüm üzerine son tasarım tek job'a indirildi. Daha az typecheck'i doğrudan daha düşük fatura diye sunma. Önce/sonra gerçek süre, çalışan job sayısı ve yuvarlanmış runner süresi S06 devrinde kaydedilir; tek örnek hız veya fiyat garantisi değildir. İptal edilen eski PR koşusunun o ana kadar tükettiği süre silinmez.

## Resmi kaynaklar

- [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Required checks ve review kuralları](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Ruleset REST şeması ve Administration yetkisi](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)
