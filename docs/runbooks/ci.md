# CI ve main birleşme kontrolü

S06 uygulaması; güncel kabul ve açık erişim işi [S06 devrinde](../handoffs/S06.md) ve [TASKS](../../TASKS.md) içindedir. Bu dosyanın veya JSON'un Git'e eklenmesi GitHub ayarını etkinleştirmez.

## Çalışma yolu

CI her kaynak/hedef branch'teki PR ve main push için çalışır. Böylece üst üste kurulan PR'lar da main'e alınmadan test edilebilir. Workflow düzeyinde dosya filtresi yoktur; `CI gate` sabit sonuçtur. Aynı PR'a yeni commit eski run'ı iptal eder; farklı PR ve staging koşularına dokunmaz. CI secrets/deploy/admin yetkisi kullanmaz; checkout credential'ı saklanmaz.

`ci-scope.mjs` PR merge-base/head veya push before/after arasındaki bütün yolları NUL ayrımlı Git diff ile okur. Yalnız izinli kök Markdown dosyaları ve `docs/**/*.md` belge kolunu seçer. Silinen dosya ve rename'in iki tarafı dahildir. Bilinmeyen, karma, bozuk veya eksik diff tam kod kontrolüne düşer. Yeni bir dosya türü kendiliğinden hafif sayılmaz.

| Yol | Çalışan işler | Kurulum / typecheck / PG17 |
| --- | --- | --- |
| Yalnız izinli belge | Scope and documents → CI gate | 0 / 0 / 0 |
| Kod, migration, CI, karma veya belirsiz | Scope and documents → Code and PostgreSQL → CI gate | 1 / 1 / 1 |

Belge doğrulayıcı Git'te izlenen Markdown'ın yerel linklerini, TASKS bağımlılıklarını/döngülerini/durumlarını, faz kapılarını ve mevcut durumdaki açık S-görev beyanlarını denetler. Tarihsel devir metni güncel durum gibi yorumlanmaz. Harici URL erişilebilirliği ve bölüm anchor'ları ağ taramasıyla doğrulanmaz.

Tam kolun tek yürütücüsü `scripts/ci-code.mjs` şu sırayı uygular: çalıştırılabilir envanter, high/critical bağımlılık denetimi, typecheck, default build, Chrome smoke, Worker dry-run, recursive Node testleri, staging build, PostgreSQL planı ve S05 gerçek psql bağlantı testi. Default build'in smoke/dry-run kontrolü staging build'den önce kalır. Sonuç ancak bütün alt süreçler başarılıysa `complete=true` üretir. Belge doğrulayıcısının ayrıca tamamlanma çıktısı vardır. Aggregate; sonuç/kol/çıktı eşleşmezse, zorunlu kontrol eksik/iptal/atlandıysa kırılır.

## Katkıda bulunurken

- Belge: `npm run test:docs` (npm kurulumu gerektirmeyen karşılığı `node scripts/ci-docs.mjs`). Yeni dosyaları Git'e ekle; çalışma dizininde olup izlenmeyen link hedefi geçmez.
- Kod: `npm ci`, `npm run typecheck`, `npm run build`, ilgili davranış testleri. Yerel `build` ve `build:staging` kendi typecheck korumasını sürdürür. `build:ci` / `build:staging:ci` yalnız öncesinde typecheck çalıştıran CI içindir.
- Yeni SQL dosyası: `scripts/ci-postgres-plan.json` içine doğru database ve upgrade aşamasında gerçek adımı ekle; `npm run test:ci-coverage` çalıştır. Yalnız YAML yorumuna isim eklemek geçmez. Birleştirilmiş migration içeriği değişmez.
- Yeni Node testi: `tests/` altında `.test.mjs`; alt dizinler dahil gerçek runner keşfeder. Elle wildcard veya ayrı isim listesi tutulmaz.
- SQL yerel tam çalıştırma yalnız **atılabilir test PostgreSQL 17** üzerinde yapılır; plan `yzt_upgrade` ve `yzt_s03_upgrade` test DB'lerini yeniden oluşturur. Hosted Supabase/staging/production bağlantısı verilmez.
- Herhangi bir CI altyapısı değişimi aynı PR'ın kod incelemesine tabidir. Repo içindeki testler, kendi dosyalarının kasıtlı değiştirilmesine karşı harici güvenlik sınırı değildir; gerekli inceleme kuralı bunun için ayrıca kurulur.

## Main kural paketi — yöneticiye hazır

[main-ruleset.json](../../.github/main-ruleset.json) main için şunları ister: PR üzerinden değişiklik, en az bir yetkili onay, yeni commit'te eski onayın düşmesi, son push'ı yapan dışından onay, çözülmüş inceleme konuşmaları, güncel base üzerinde **CI gate** başarısı, force-push ve silme engeli. Bypass listesi boştur. GitHub Actions app ID `15368`, mevcut main'in gerçek check-run kaydından okunmuştur; S06 check adı da gerçek run'dan ayrıca doğrulanır.

**Önkoşul:** PR yazarından/son push yapan kişiden farklı, inceleme onayı verebilen yetkili GitHub hesabı bulunmalıdır. Aynı hesaba bağlı iki ajan bağımsız GitHub onayı oluşturmaz. Bu kimlik hazır olmadan tek kişilik repoda körlemesine etkinleştirme yapılmaz; inceleme şartı sıfıra indirilmez ve bypass eklenmez.

Repo sahibi `Settings → Rules → Rulesets → New ruleset → Import a ruleset` üzerinden JSON'u içe aktarabilir. Yetkili yönetici CLI alternatifi (değerler secret içermez):

```bash
gh api --method POST repos/ziyabeey1-ai/randevu/rulesets --input .github/main-ruleset.json
```

Aynı kural varsa ikinci kez oluşturma; mevcut ID'nin ayarını karşılaştırıp güncelle. Yönetici erişimi bağlı uygulamada yoktur: branch-protection okuması `403 Resource not accessible by integration`, rulesets listesi boş ve main `protected:false` döndü. Bu erişim sınırı nedeniyle kod PR'ı ile gerçek koruma kabulü ayrı kaydedilir.

Uygulamadan sonra geri oku:

```bash
gh api repos/ziyabeey1-ai/randevu/rulesets
gh api repos/ziyabeey1-ai/randevu/rules/branches/main
gh api repos/ziyabeey1-ai/randevu/pulls/PR_NUMBER
gh api repos/ziyabeey1-ai/randevu/commits/HEAD_SHA/check-runs
```

Aktif main kapsamı, bypass yokluğu, review sayısı ve son-push şartı, strict required `CI gate`/GitHub Actions kaynağı; PR'ın güncel head/merge sonucu ve uygun onayı birlikte doğrulanır. Yeşil eski commit yeterli değildir. Başarısız CI ve eksik inceleme merge'i gerçekten engellemelidir. Bu kanıt gelmeden S06 tamamlanmış sayılmaz.

## Maliyet kanıtının sınırı

Belge kolunda npm kurulumu ve DB container yoktur; kod kolunda üç typecheck bir olur. Ayrı aggregate/scope işleri runner başlatma ve dakika yuvarlama maliyeti ekler. Bu nedenle daha az typecheck'i doğrudan daha düşük fatura diye sunma. Önce/sonra gerçek süre, çalışan job sayısı ve yuvarlanmış runner süresi S06 devrinde kaydedilir; tek örnek hız veya fiyat garantisi değildir. İptal edilen eski PR koşusunun o ana kadar tükettiği süre silinmez.

## Resmi kaynaklar

- [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Required checks ve review kuralları](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Ruleset REST şeması ve Administration yetkisi](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)
