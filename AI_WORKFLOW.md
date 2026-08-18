# AI Workflow

Bu belge, projenin yapay zeka ile **nasıl** geliştirildiğini anlatır: hangi işler araca devredildi, hangi kararlar insanda kaldı ve üretilen kodun doğruluğu neye göre belirlendi.

Belgedeki her örnek gerçek oturum akışından ve commit geçmişinden alınmıştır.

---

## Kullanılan Tek Araç: Claude Code

Projede **başka hiçbir yardımcı IDE aracı kullanılmamıştır.** Ne Copilot, ne Cursor, ne Windsurf, ne de başka bir kod tamamlama eklentisi devrede olmadı. Tüm süreç yalnızca **Claude Code** (Anthropic) terminal asistanı ile yürütüldü.

Claude Code, dosya okuma/yazma ve komut çalıştırma yetkisine sahip agentic bir araçtır. Bu, projedeki doğrulama disiplininin temelini oluşturur: araç ürettiği kodu aynı oturumda derleyip, testini koşup, canlı servislere karşı çalıştırabilir. "Muhtemelen çalışır" ile "çalıştığı ölçüldü" arasındaki fark buradan gelir.

> `.gitignore` içinde `.windsurf/` ve `.cursor/` girdileri görülebilir. Bunlar `prisma init` komutunun kurulum sırasında bıraktığı **jenerik yer tutuculardır**; karşılık gelen klasörler bu projede hiç oluşmadı. Girdiler, ilgili araçlardan biri ileride kullanılırsa artıklarının repoya sızmaması için savunma amaçlı bırakıldı.

---

## Temel İlke: Üretilen Kod, Doğrulanmadıkça Kod Değildir

Bu projede benimsenen kural şudur: **yapay zekanın ürettiği hiçbir çıktı, çalıştırılarak doğrulanmadan "tamam" sayılmaz.**

Doğrulama, projenin ilerleyen aşamalarında sözdizimi kontrolünün çok ötesine geçti — canlı Upstash, MongoDB Atlas ve Neon servislerine karşı ölçüm yapıldı:

| Üretilen | Doğrulama | Sonuç |
|----------|-----------|-------|
| `prisma/schema.prisma` | `npx prisma validate` | ✅ Geçti |
| Prisma client | `npx prisma generate` | ✅ Üretildi |
| Tüm TypeScript kaynak | `npm run build` | ✅ Hatasız derlendi |
| `docker-compose.yml` | `docker compose config -q` + `up -d` | ✅ Üçü de `healthy` |
| Redis ZSET komutları | Canlı Upstash'e `ZADD`/`ZREVRANK`/`ZINCRBY` | ✅ `ZINCRBY` yeni toplamı döndürüyor |
| Idempotency korumas | Atlas'a aynı anahtarla iki yazım | ✅ İkincisi **E11000** ile reddedildi |
| Ödül matematiği | 14 birim testi | ✅ Dağıtılan toplam = havuz, kuruşu kuruşuna |
| Uçtan uca dağıtım | 100 oyuncuya gerçek dağıtım | ✅ `10000.00` havuz → `10000.00` dağıtıldı |
| Gecikme iddiaları | 100.000 üyelik ZSET'te ölçüm | ✅ 200 üye ile aynı: 49 ms |
| RBAC koruması | 3 yetki yükseltme senaryosu, canlı HTTP | ✅ Rolsüz **403**, kurcalanmış **401**, yabancı imza **401** |
| Neon pooler geçişi | Transaction + 400 eş zamanlı bağlantı | ✅ TX/rollback sorunsuz; pooler **179/400**, direct **0/400** |

Son satır özellikle önemli: "Redis `O(log N)`, ölçekten etkilenmez" cümlesi bir iddia olarak bırakılmadı, 100.000 üyeye kadar çıkılıp ölçüldü.

### Doğrulamanın ertelendiği bir adım ve nasıl kapatıldığı

`docker compose up -d` ilk denemede çalıştırılamadı. Sebep projeyle ilgili değildi: Docker daemon'ı (Colima) disk alanı yetersizliğinden başlamıyordu.

```
level=fatal msg="truncate /Users/alpis/.colima/_lima/colima/disk: no space left on device"
```

O aşamada yalnızca compose dosyasının **sözdizimi** doğrulanabildiği için, servislerin gerçekten ayağa kalktığı **doğrulanmamış olarak raporlandı** — "muhtemelen çalışır" denilerek geçilmedi. Disk alanı açıldıktan sonra adım tekrarlandı ve üç servis de 7 saniyede `healthy` durumuna geçti.

Buradaki asıl nokta: doğrulanamayan bir adım "başarılı" sayılmadı, açık bir eksik olarak işaretlendi ve engel kalktığında gerçekten çalıştırılarak kapatıldı.

---

## Human-in-the-Loop: Kararların Nerede Verildiği

Süreç, **seçeneklerin gerekçeleriyle serildiği** ve **hangi yolun tutulacağına karar verildiği** bir döngü olarak işledi. Kritik olan, kararın nerede verildiğidir: kod yazıldıktan sonra değil, önce.

Somut mekanizma şuydu: kod yazmaya başlamadan önce, farklı okumaların **maddi olarak farklı işe** yol açacağı noktalarda süreç durur, alternatifler ve sonuçları serilir, yön belirlenir. Aşağıdaki kararlar bu döngüden geçmiştir.

### Geliştiricinin verdiği mimari ve ekonomi kararları

| Karar | Geliştiricinin seçimi | Sonucu |
|---|---|---|
| **Negatif delta havuzu etkilesin mi?** | Yalnızca pozitif delta katkı yapsın | Bir oyuncuya kesilen ceza, tüm oyuncuların ödül bütçesini azaltmıyor. `poolContributionMinor()` içindeki `delta <= 0` kontrolü bu kararın kod karşılığıdır |
| **Dağıtımda cüzdan bakiyesi artsın mı?** | Evet, aynı transaction'da artsın | `RewardLog` + `Wallet.balance` + `version` tek transaction'da yazılıyor; ödül gerçekten "ödenmiş" oluyor |
| **Haftalık dağıtım nasıl tetiklensin?** | Otomatik cron **ve** manuel endpoint | Pazartesi 00:05 UTC cron + Redis `SET NX` kilidi; ayrıca elle tetiklenebilir uç |
| **`seasonId`'yi kim belirlesin?** | Sunucu türetsin, istemci gönderemesin | İstemcinin kapanmış — hatta ödülü dağıtılmış — bir sezona skor yazması imkânsız |
| **Skor gönderiminde `userId` doğrulansın mı?** | Hayır, yazma yolu Postgres'e dokunmasın | 2M DAU'da her idle tick'te transactional veritabanına sorgu düşmüyor |
| **Liderlik tablosunda username gösterilsin mi?** | Evet, Postgres'ten tek sorguyla | Sayfa başına 1 indeksli `IN` sorgusu; sıralama tamamen Redis'te kalıyor |
| **Şema `db push` ile mi uygulansın?** | Evet, geliştirici onayıyla canlı Neon'a | Migration geçmişi bırakmıyor; README'ye "üretim öncesi `migrate dev`'e geçilmeli" notu düşüldü |

Bu kararların hiçbiri varsayımla geçilmedi. Örneğin negatif delta konusunda iki seçenek de gerekçesiyle masaya kondu (havuz matematiksel tutarlılık için azalsın mı, yoksa monoton artsın mı); seçilen yargı — *"bir oyuncuya kesilen ceza tüm oyuncuların havuzunu azaltmamalı"* — teknik değil **ekonomik** bir karardır ve kodun modelini doğrudan belirlemiştir.

### Belirsizliğin varsayımla doldurulmaması

Aynı disiplin projenin en başında da işledi. Görev metninde HTTP motoru cümlesi yarıda kesilmişti ("Express yerine yüksek performanslı ..."). Sessizce bir tahmin yürütmek yerine varsayım (Fastify) **açıkça belirtilip onay alınarak** ilerlendi.

Kod yazmaya başlamadan önce üç karar daha geliştiriciye soruldu: MongoDB'nin rolü, Prisma şemasının derinliği ve kurulum yöntemi. Bunlar sonradan yeniden yapılandırma gerektirecek türden sorulardı — yanlış varsayımla ilerlemek, sonradan düzeltmekten pahalıdır.

### Planın onaya sunulması

İş mantığı katmanına geçilirken doğrudan kod yazılmadı. Önce mevcut kod tabanı incelendi, canlı servislere karşı varsayımlar ölçüldü ve **yazılı bir plan geliştiricinin onayına sunuldu.** Plan onaylanmadan tek satır kod yazılmadı — geniş çaplı bir değişikliğin yönü, uygulanmadan önce netleşmiş olur.

---

## Üç Yapılandırma Tuzağı ve Nasıl Kapatıldığı

Kurulum aşamasında üç yapılandırma sorunu çıktı. Üçü de sessizce yanlış çalışan türdendi — derleme geçiyor, uygulama açılıyor, ama davranış beklenenden farklı oluyordu. Bu yüzden ayrı bir başlıkta toplandılar: bu tür sorunlar ancak çalıştırıp doğrulayarak görülür.

### 1. `MONGO_URI`'de eksik veritabanı adı

Keşif sırasında `.env` içindeki bağlantı adresinin yol kısmının boş olduğu görüldü:

```
mongodb+srv://...mongodb.net/?appName=Cluster0
                             ^ veritabanı adı yok
```

Mongoose bu durumda sessizce varsayılan `test` veritabanına yazar. Hata vermez, log basmaz — kayıtlar yanlış yere gider ve bu ancak aylar sonra fark edilir.

Bulgu ölçümle doğrulandı, plana bir madde olarak eklendi ve geliştiricinin onayıyla `app.module.ts` içine `dbName: 'leaderboard'` satırı yazıldı. `.env` dosyasına dokunulmadı.

### 2. Prisma 7 driver adapter zorunluluğu

`PrismaService`, `PrismaClient`'ı adapter'sız oluşturuyordu. Prisma 7'de bu çalışmaz — üretilen tip tanımı bunu açıkça söylüyordu:

```ts
// generated/prisma/internal/prismaNamespace.ts:989
adapter: runtime.SqlDriverAdapterFactory   // opsiyonel değil
```

Yani uygulama Postgres'e hiç bağlanamıyordu. Ayrıca `prisma.config.ts` yalnızca CLI'yi kapsıyor, runtime client'ı kapsamıyordu — bu ayrım kolayca gözden kaçabilecek bir noktaydı.

Çözüm için iki adapter karşılaştırıldı ve gerekçesiyle sunuldu: `@prisma/adapter-neon` (WebSocket, edge ortamları için) yerine `@prisma/adapter-pg` (düz TCP) seçildi — çünkü burada uzun ömürlü bir Nest sunucusu var, edge fonksiyonu değil.

### 3. Modül formatı çakışması ve Neon transaction timeout'u

Bu ikisi **çalışma anında patladı** ve iteratif geri bildirim döngüsüyle kapatıldı:

**Modül çakışması.** Üretilen Prisma client `import.meta.url` kullanıyordu; Node dosyayı ESM sanıp gövdeyi CommonJS bulunca sunucu `exports is not defined in ES module scope` ile açılmıyordu. `moduleFormat = "cjs"` ve `importFileExtension = ""` ayarlarıyla çözüldü.

**Neon timeout'u.** İlk dağıtım denemesi 500 verdi. Log okundu:

```
Transaction API error: timeout for this transaction was 5000 ms,
however 5240 ms passed since the start of the transaction.
```

Teşhis: oyuncu başına ayrı `create` + `upsert` yazmak, 100 oyuncuda **200 ardışık sorgu** demekti; Neon'a her sorgu ~25 ms olduğundan varsayılan 5 saniyelik limit aşılıyordu.

Burada iki seçenek vardı: timeout'u artırmak, ya da sorgu sayısını düşürmek. Yalnızca timeout artırmak semptomu gizlerdi — asıl sorun ardışık gidiş-dönüş sayısıydı. **Toplu yazım (`createMany`) yönünde karar verildi**; cüzdanlar mevcut/yeni ayrımına göre gruplandı. Süre **5.2 saniyeden 1.4 saniyeye** düştü.

Bu olayda kritik olan başka bir doğrulama daha yapıldı: hata sonrası veritabanı durumu kontrol edildi ve transaction'ın **temiz geri alındığı** görüldü (0 `RewardLog`, 0 `Wallet`, Redis korunmuş). Yani atomiklik tasarımı gerçek bir hata senaryosunda sınandı ve geçti — kısmi ödeme oluşmadı.

---

## Performans Darboğazının Kovalanması

### Talebin kaynağı

Uçlar çalışır durumdaydı ve ölçümler kabul edilebilir görünüyordu. Geliştirici bu noktada durmadı: `/api/me` ucunun her istekte Postgres'e iki ayrı sorgu atmasının, 2M DAU hedefindeki bir sistemde kalıcı bir darboğaz olduğunu tespit etti ve optimize edilmesini istedi.

Bu, aracın kendiliğinden gündeme getirmeyeceği bir taleptir — uç zaten "çalışıyor" durumdaydı.

### Ölçüm önce, çözüm sonra

Tahminle hareket edilmedi. Her veri deposuna tek tek gecikme ölçüldü:

| İşlem | Süre |
|---|---|
| Postgres `SELECT 1` (boş sorgu) | **57 ms** |
| Postgres `findMany` 100 satır | 68 ms |
| Redis `ZREVRANGE` 100 üye | 63 ms |

`SELECT 1`'in de 57 ms sürmesi belirleyici oldu: maliyet **satır sayısından değil, gidiş-dönüşün kendisinden** geliyordu. Ardından eşzamanlılık taraması yapıldı:

| Eşzamanlılık | `/me` (Postgres'e gider) | `/rewards/season` (yalnız Redis) |
|---|---|---|
| 10 | 80 RPS · p50 76 ms | 104 RPS · p50 75 ms |
| 25 | 95 RPS · p50 206 ms | 215 RPS · p50 **78 ms** |
| 50 | 108 RPS · p50 489 ms | 277 RPS · p50 150 ms |

Redis'e giden uç eşzamanlılıkla **ölçekleniyor** (p50 sabit), Postgres'e giden **ölçeklenmiyordu**.

### Reddedilen ilk çözüm

İlk akla gelen "iki sorguyu tek JOIN'e indir" fikri uygulandı ve **ölçülerek reddedildi**: 147 RPS → 93 RPS. Prisma'nın ilişkili sorgusu tek tur atıyor ama daha pahalı bir plan üretiyordu. Değişiklik geri alındı.

Buradaki disiplin şuydu: *makul görünen bir optimizasyon, ölçüm onaylamadıkça uygulanmaz.*

### Bulunan optimal çözüm

Doğru soru "kaç sorgu?" değil, **"Postgres'e gitmek zorunda mıyız?"** idi. Cevap hayırdı:

- Kullanıcı adı ve ülke zaten liderlik tablosunun doldurduğu profil cache'inde duruyordu.
- Bakiye ve son ödül **yalnızca haftalık dağıtımda** değişiyordu — yani cache'lenmeye en uygun veri türü.

Cüzdan özeti Redis'e alındı ve geçersiz kılma tek noktaya bağlandı: `RewardsService` dağıtımı Postgres'e yazdıktan **sonra** ilgili anahtarları siler. Sıra önemliydi — önce silinseydi, yazma tamamlanana kadar gelen bir istek eski değeri yeniden cache'lerdi.

| Uç | Önce | Sonra |
|---|---|---|
| `GET /api/me` | 43 RPS | **659 RPS** |
| `GET /api/me/wallet` | 123 RPS | **757 RPS** |

Doğruluk uçtan uca sınandı: gerçek bir dağıtım çalıştırıldı, bakiyenin `0.0000 → 180.0000` olarak güncellendiği ve `/me` ile `/me/wallet`'ın aynı değeri döndürdüğü doğrulandı.

### Yan ürün: para biçiminde bulunan tutarsızlık

Bu doğrulama sırasında ilgisiz bir hata ortaya çıktı: Prisma'nın `Decimal.toString()`'i sondaki sıfırları atıyor, aynı alan bazen `"90"` bazen `"0.0000"` dönüyordu. Şema `Decimal(18,4)` olduğu için biçim sabit olmalıydı; tüm para alanları `toFixed(4)`'e çevrildi.

Hata aranmıyordu — **doğrulama disiplini onu kendiliğinden yüzeye çıkardı.**

## Otomatik Önerinin Uygulanmadığı Noktalar

Bir aracın (npm, linter ya da asistan) önerdiği her hamle doğru değildir. Bu projede bilinçli olarak **uygulanmayan** öneriler:

### Güvenlik uyarısının körü körüne "düzeltilmemesi"

`npm install prisma` sonrası 3 adet *high severity* uyarı çıktı ve npm `npm audit fix --force` önerdi. Refleks tepki bu komutu çalıştırmaktır. Bunun yerine uyarı incelendi:

- Zafiyet `deepmerge-ts` paketinde, Prisma CLI üzerinden geliyor
- Paket bir **devDependency** — çalışma zamanına dahil değil
- `--force` uygulamak Prisma'yı 7.9'dan 6.12'ye **geri düşürecekti**

Karar: uyarı bırakıldı, gerekçesiyle birlikte not düşüldü. *Aracın önerdiği komutu çalıştırmak her zaman doğru hamle değildir.*

### Test beklentisinin koda uydurulmaması

Ödül matematiği testlerinden biri, 1. oyuncunun havuzun tam %20'sini alacağını varsayıyordu. Test kırmızı yandı: gerçekte 2000.46 alıyordu (%20 + 46 kuruş yuvarlama artığı).

Burada iki yol vardı: kodu teste uydurmak ya da testin beklentisini gözden geçirmek. İnceleme sonucu **kodun doğru olduğu** görüldü — artık kasıtlı olarak 1. oyuncuya ekleniyordu ki dağıtılan toplam havuza tam eşit olsun. Testi geçirmek için ekonomi mantığını bozmak yerine, testin beklentisi gerçek davranışa göre düzeltildi ve gerekçesi yoruma yazıldı.

### İş bölümü

Pratikte ortaya çıkan çalışma düzeni şuydu:

| Otomasyona uygun | İnsanda kalan |
| --- | --- |
| Kod tabanını tarama, tekrar ve ölü kod bulma | Ürün ve ekonomi kuralları |
| Ölçüm koşturma, sonuçları tablolaştırma | Kapsamın nerede biteceği |
| Tekrarlayan yapılandırma, import düzeltme | Mimari sınırlar ve yapı deseni |
| Belge taslağı çıkarma | Bir iddianın kabul edilip edilmeyeceği |

Sağ sütun bu belgenin asıl konusu. Sol sütunun hızı, ancak sağ sütun işlediğinde işe yarar — çünkü hızlı üretilen yanlış bir çözüm, yavaş üretilenden pahalıdır.

---

## Teslim Öncesi Denetim Turu: Nasıl Çalıştı

Kod tamamlandıktan sonra proje, case gereksinimlerine ve kod kalitesine karşı ayrı bir turda tarandı. Bu tur, iş akışının en öğretici kısmı oldu — çünkü burada otomasyonun hızı ile kararın yavaşlığı sürekli birbirine değdi.

Döngü hep aynı şekilde işledi:

```
soru sorulur → tarama yapılır, bulgu gerekçesiyle sunulur
             → iddia ölçümle sınanır
             → sonuç: uygula / kapsamı daralt / geri al
```

### Ölçüm, teşhisi değiştirdiğinde

Tarayıcı ağ panelinde aynı uçların birden çok kez çağrıldığı fark edildi ve soruldu. İlk teşhis bir React sorununa işaret ediyordu: `useSession` içindeki `epoch` sayacının yetkili uçları çift tetiklediği düşünüldü ve bir düzeltme hazırlandı.

Kabul etmek yerine ölçüm istendi. Ölçüm teşhisi çürüttü: düzeltilmiş ve düzeltilmemiş sürümler **aynı sayıda** istek atıyordu (6). Gerçek sebep basitti — case senaryolarını denemek için persona seçici elle üç kez kullanılmıştı: `6 açılış + 3 × 5 = 21`, tarayıcıdaki sayıyla birebir.

Hazırlanan düzeltme geri alındı. **Var olmayan bir soruna yazılan kod, kodun kendisinden pahalıdır** — ve bu ancak ölçümle anlaşılır.

### Kapsamın case'e göre daraltılması

Ödül dağıtım ucu için `ADMIN_SECRET` tabanlı bir koruma önerildi ve uygulandı. Ardından gelen soru kapsamı yeniden çerçeveledi: *case bir yetkilendirme sistemi istiyor mu?*

Case metni tarandı — "admin", "role", "login" kelimelerinin hiçbiri geçmiyordu. İstenen tek otomasyon şuydu: *"Rewards should go out automatically at the end of the week."* Bu zaten cron ile karşılanıyordu.

Karar: koruma kaldırıldı (`f3d9f56`). Ucun güvencesi guard yerine **idempotency**'ye bırakıldı — aynı sezon ikinci kez dağıtılamaz. Aynı kararla, hiçbir uca bağlı olmayan RBAC altyapısı (`RolesGuard`, `@Roles`, `Role.ADMIN`, ~185 satır) de silindi.

Bu, iş akışının önemli bir yanını gösteriyor: **kapsamı büyütmek kolay, geri çekmek karardır.** Case'in istemediği bir katman, ne kadar iyi yazılmış olursa olsun fazlalıktır.

### Tek ölçümün yetmediği yer

Render'ın ücretsiz planı 15 dakika boşta kalan servisi uyutuyordu. Çözüm olarak GitHub Actions ile 10 dakikada bir ping kuruldu ve 16 dakikalık bir bekleme testiyle doğrulandı — test geçti.

Ertesi gün servisin yine uyuduğu fark edildi. İnceleme, tek testin **şanslı bir pencereye** denk geldiğini gösterdi: gerçek tetikleme aralıkları 19-32 dakika arasında değişiyordu, çünkü GitHub Actions'ın `schedule` tetikleyicisi zamanlama garantisi vermez.

```
#2 22:57   #3 23:16 (+19)   #4 23:41 (+25)   #5 00:00 (+19)   #6 00:32 (+32)
```

Çözüm iki katmanlı hale getirildi: birincil ping garantili çalışan harici bir zamanlayıcıya taşındı, Actions yedek olarak kaldı. **Tekrarlanabilirliği olmayan bir ölçüm, kanıt değildir.**

### Yıkıcı işlemlerin onaya bağlanması

Ödül dağıtımı akışı doğrulanırken yerel sunucu başlatıldı — ancak sunucu `.env` üzerinden **canlı** veritabanlarına bağlıydı. Dağıtım gerçekten çalıştı ve canlı sıralamayı sıfırladı.

İşlem geri alınabilirdi (`npm run seed -- --reset`) ve dağıtımın doğru çalıştığını kanıtladı, ama öncesinde sorulmalıydı. Bu olaydan sonra yıkıcı komutlar açık onaya bağlandı.

---

## Denetimde Çıkan Bulgular ve Verilen Kararlar

Tarama somut bulgular üretti; her birinde **ne yapılacağı ayrı bir karardı.**

### Ödül kuralının case metnine göre düzeltilmesi

Case: *"the remaining 55% is distributed among players ranked 4th through 100th, **based on their rank**."* Uygulama bunu skora orantılı yapıyordu.

Karar ölçüme dayandırıldı. Canlı veri, skora orantılı dağıtımın kuralı işlevsiz kıldığını gösterdi: ilk 100'e girenlerin skorları birbirine çok yakındır (1,18 kat), dolayısıyla 4. sıra 100. sıradan yalnızca **%18** fazla alıyordu. Sıra tabanlı ağırlıkta aynı fark **97 kata** çıkıyor.

| | Skora oranlı | Sıraya oranlı (seçilen) |
| --- | --- | --- |
| 4. sıranın payı | ₺585.957 | ₺1.055.313 |
| 100. sıranın payı | ₺497.536 | ₺10.880 |

Kural sıraya orantılıya çevrildi (`62626c1`): hem case'in lafzına uyuldu, hem ödül yapısı anlamlı hale geldi.

### Para matematiğinde iki sızıntı

- **%55'in tamamının 1. oyuncuya gitmesi.** Kuyruktaki oyuncuların skoru yoksa orantı tanımsız kalıyor, `%55` hiç dağıtılmıyor ve artık hesabı tamamını 1. oyuncuya ekliyordu — o oyuncu case'in öngördüğü %20 yerine **%75** alıyordu (`c5ed594`).
- **Özet toplamının float'a düşmesi.** `getRewardHistory`, projenin "para asla float'a düşmez" disiplinini tam da para toplarken kırıyordu (`6992203`).

İkisi de testle sabitlendi. Dikkat çekici olan şu: mevcut test birinci sorunu **yakalamıyordu**, çünkü yalnızca toplamı kontrol ediyor, parayı kimin aldığına bakmıyordu. Test de güçlendirildi ve eski kodla kırmızıya düştüğü doğrulandı.

### Klasör yapısının toparlanması

Yönlendirme netti: *"30 kişilik bir ekip bu depoya girdiğinde herkes okuyabilmeli."* Yön de belirtildi — modül sınırlarına dokunulmayacak, her modülün içi katmanlara ayrılacak, testler kaynak dosyaların yanından çıkarılacak.

Bir alternatif olarak katman bazlı yapı (tüm controller'lar tek klasörde) sunuldu ve değerlendirildi; bir özelliğe dokunmak için birden çok klasör gezmeyi gerektirdiği için tercih edilmedi. Uygulanan yapı (`1e8daba`):

```
leaderboard/
├── controllers/   ├── services/
├── dto/           └── tests/
```

33 dosyanın import yolu güncellendi; TypeScript hatası sıfır, 58 birim + 10 e2e test geçti, uygulama ayağa kalktı ve tüm uçlar doğrulandı.

### Testin kendi ortamını kirletmesi

E2E testi gerçek bir skor gönderiyor ve sahte kullanıcıyı canlı sıralamada bırakıyordu; sıralamadan oyuncu seçen uçlar bu üyeyi seçip Postgres'te bulamayınca **404** dönüyordu. Yani test, kendisinden sonra çalışan her şeyi bozuyordu — ve bu, canlı sistemde fark edildi.

`afterAll` artık sahte kullanıcıyı siliyor **ve havuza yaptığı katkıyı geri alıyor** (`45ca24b`); aksi halde her koşu ödül havuzunu birkaç kuruş şişirirdi. Temizliğin çalıştığı, koşu sonrası Redis durumu seed değerleriyle karşılaştırılarak doğrulandı.

---

## İnsan Kararı Olarak Kalan Diğer Mimari Tercihler

Aşağıdakiler araca sorulup kabul edilen öneriler değil, gerekçesiyle verilmiş **tasarım kararlarıdır**:

- **Bakiyede `Decimal`, `Float` değil.** Kayan nokta aritmetiği para için yuvarlama hatası üretir; 2M kullanıcıda bu sızıntı demektir. Aynı disiplin ödül matematiğinde de sürdürüldü: havuz Redis'te **kuruş cinsinden tamsayı** tutuluyor (`INCRBY`), çünkü `INCRBYFLOAT` haftada milyonlarca artışta sapma biriktirir.
- **`RewardLog` üzerinde `(userId, seasonId)` tekil kısıtı.** Dağıtım job'ının yeniden çalışması ihtimaline karşı idempotency, uygulama kodunda değil **veritabanı seviyesinde** garanti altına alındı. Redis kilidi tek başına yeterli değildir — TTL dolabilir, Redis yeniden başlayabilir; asıl güvence veritabanı kısıtıdır.
- **Bakiyenin `increment` ile güncellenmesi.** Postgres `UPDATE ... SET balance = balance + x` ifadesini satır kilidi altında atomik uygular; eşzamanlı iki ödül yazımı birbirini ezmez. Okuyup hesaplayıp geri yazmak lost update riski doğururdu. (Denetimde belgenin ve kod yorumlarının bu korumayı yanlışlıkla `Wallet.version` alanına atfettiği görüldü — o alan yalnızca yazım sayacıdır, `where: { version }` kontrolü yoktur; yorumlar gerçeğe göre düzeltildi.)
- **Sıralamanın Redis'te olması.** Liderlik tablosunun okuma yolu transactional veritabanında sıralama veya tarama yapmaz. Bu iddia ölçümle sınandı: 100.000 üyelik ZSET'te `ZREVRANK`, 200 üyelikle **aynı süreyi** verdi (49 ms) ve 99.000. sıradaki oyuncunun penceresi ilk 10 kadar hızlı çekildi.
- **Kimlik doğrulamanın sıfır I/O olması.** JWT guard yalnızca bellekte HMAC imza kontrolü yapar. Ölçüldü: doğrulama başına **22 mikrosaniye** — bir Redis çağrısının 2.200'de biri. Yazma yolu kimlik doğrulama yüzünden yavaşlamıyor.
- **Healthcheck'lerde gerçekçi parametreler.** `pg_isready` çağrısına `-U`/`-d` verildi; bunlar olmadan komut varsayılan kullanıcıya bakar ve veritabanı hazır değilken yanlışlıkla "hazır" raporlayabilir. Mongo için `start_period: 20s` verildi, çünkü ilk açılışta başlatma işlemi port açıldıktan sonra da devam eder.

---

## Özetle

Bu projede yapay zeka **iskelet kurma, tekrarlayan yapılandırma, kod tarama, ölçüm ve dokümantasyon taslağı** aşamalarında kullanıldı. Tek başına gözden kaçabilecek somut sorunları yüzeye çıkardı: eksik Mongo veritabanı adı, Prisma 7 adapter zorunluluğu, transaction timeout'u, ödül kuyruğundaki para sızıntısı, belge–kod tutarsızlıkları.

İş akışının belirleyici kuralı tek cümleyle şudur: **hiçbir iddia, ölçülmeden kabul edilmez.**

Bu kural üç şekilde işledi:

- **Doğrulama** — "Redis O(log N)" gibi bir cümle iddia olarak bırakılmadı, 100.000 üyeye çıkılıp ölçüldü. Idempotency, ödül matematiği, pooler geçişi, JWT doğrulaması hep canlı servislere karşı sınandı.
- **Teşhisin sorgulanması** — İnandırıcı ama yanlış bir teşhis üretilebilir. Var olmayan bir React sorunu için hazırlanan düzeltme, ölçüm iddiayı çürüttüğü için geri alındı.
- **Kapsamın çerçevelenmesi** — Case'in istemediği bir yetkilendirme katmanı, iyi yazılmış olmasına rağmen kaldırıldı. Kapsamı büyütmek kolaydır; geri çekmek karardır.

Ekonomi modelinin kuralları, güvenlik ve mimari sınırlar, `%55`'in nasıl dağıtılacağı, klasör yapısının hangi desende toparlanacağı — bunların hepsi gerekçesiyle verilmiş **tasarım kararlarıdır.**

Bir aracın değeri, ürettiği kod kadar **ürettiği kodun nerede sorgulandığıyla** ölçülür.
