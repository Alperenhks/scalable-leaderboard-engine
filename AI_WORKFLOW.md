# AI Workflow

Bu belge, projenin yapay zeka desteğiyle nasıl geliştirildiğini açıklar. Amacı, kod üretiminin hangi noktada hızlandırıcı olduğunu ve **direksiyonun kimde kaldığını** somut örneklerle göstermektir.

Belgedeki her örnek gerçek oturum akışından alınmıştır. Kimin neyi bulduğu, sonradan güzelleştirilmeden yazılmıştır — çünkü böyle bir belgenin tek değeri doğruluğudur.

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

Yapay zeka bu projede hiçbir zaman tek başına yön belirlemedi. Süreç, aracın **seçenekleri gerekçeleriyle sunduğu**, geliştiricinin ise **hangi yolun tutulacağına karar verdiği** bir döngü olarak işledi.

Somut mekanizma şuydu: kod yazmaya başlamadan önce, farklı okumaların **maddi olarak farklı işe** yol açacağı noktalarda araç durdu ve geliştiriciye seçenekleri sundu. Aşağıdaki kararların tamamı bu şekilde **geliştirici tarafından verilmiştir** — araç yalnızca alternatifleri ve sonuçlarını serdi.

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

Bu kararların hiçbiri araç tarafından varsayılmadı. Örneğin negatif delta konusunda araç iki seçeneği de gerekçesiyle sundu (havuz matematiksel tutarlılık için azalsın mı, yoksa monoton artsın mı); **"ceza tüm oyuncuların havuzunu azaltmamalı" yargısı geliştiriciye aittir** ve kodun ekonomi modelini doğrudan belirlemiştir.

### Belirsizliğin varsayımla doldurulmaması

Aynı disiplin projenin en başında da işledi. Görev metninde HTTP motoru cümlesi yarıda kesilmişti ("Express yerine yüksek performanslı ..."). Sessizce bir tahmin yürütmek yerine varsayım (Fastify) **açıkça belirtilip onay alınarak** ilerlendi.

Kod yazmaya başlamadan önce üç karar daha geliştiriciye soruldu: MongoDB'nin rolü, Prisma şemasının derinliği ve kurulum yöntemi. Bunlar sonradan yeniden yapılandırma gerektirecek türden sorulardı — yanlış varsayımla ilerlemek, sonradan düzeltmekten pahalıdır.

### Planın onaya sunulması

İş mantığı katmanına geçilirken doğrudan kod yazılmadı. Önce mevcut kod tabanı incelendi, canlı servislere karşı varsayımlar ölçüldü ve **yazılı bir plan geliştiricinin onayına sunuldu.** Plan onaylanmadan tek satır kod yazılmadı. Bu, aracın kendi kendine geniş çaplı değişiklik yapmasını yapısal olarak engelleyen bir kontrol noktasıdır.

---

## Aracın Yakaladığı, Geliştiricinin Onayladığı Sorunlar

Aşağıdaki üç sorun **araç tarafından tespit edilmiş**, teşhis ve çözümü geliştiriciye gerekçesiyle raporlanmış, düzeltme onaylanarak uygulanmıştır. Şeffaflık adına ayrı bir başlık altında toplanmışlardır — bunlar geliştiricinin gözünden kaçırdığı değil, aracın kod tabanını tarayarak yüzeye çıkardığı ve geliştiricinin karara bağladığı bulgulardır.

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

## Aracın Önerisinin Reddedildiği Noktalar

Yapay zekanın önerdiği her hamle doğru değildir. Bu projede bilinçli olarak **uygulanmayan** öneriler:

### Güvenlik uyarısının körü körüne "düzeltilmemesi"

`npm install prisma` sonrası 3 adet *high severity* uyarı çıktı ve npm `npm audit fix --force` önerdi. Refleks tepki bu komutu çalıştırmaktır. Bunun yerine uyarı incelendi:

- Zafiyet `deepmerge-ts` paketinde, Prisma CLI üzerinden geliyor
- Paket bir **devDependency** — çalışma zamanına dahil değil
- `--force` uygulamak Prisma'yı 7.9'dan 6.12'ye **geri düşürecekti**

Karar: uyarı bırakıldı, gerekçesiyle birlikte not düşüldü. *Aracın önerdiği komutu çalıştırmak her zaman doğru hamle değildir.*

### Test beklentisinin koda uydurulmaması

Ödül matematiği testlerinden biri, 1. oyuncunun havuzun tam %20'sini alacağını varsayıyordu. Test kırmızı yandı: gerçekte 2000.46 alıyordu (%20 + 46 kuruş yuvarlama artığı).

Burada iki yol vardı: kodu teste uydurmak ya da testin beklentisini gözden geçirmek. İnceleme sonucu **kodun doğru olduğu** görüldü — artık kasıtlı olarak 1. oyuncuya ekleniyordu ki dağıtılan toplam havuza tam eşit olsun. Testi geçirmek için ekonomi mantığını bozmak yerine, testin beklentisi gerçek davranışa göre düzeltildi ve gerekçesi yoruma yazıldı.

### Belgede gerçeğin güzelleştirilmemesi

Bu belgenin kendisi de aynı denetimden geçti. Belgenin ilk talebi, yukarıdaki üç bulgunun (Mongo URI, Prisma adapter, `createMany`) tamamının geliştirici tarafından tespit edildiği şeklinde yazılmasıydı. Oturum geçmişi bununla örtüşmüyordu: bu üçünü araç yüzeye çıkarmış, geliştirici karara bağlamıştı. Buna karşılık ekonomi ve mimari kararların tamamı gerçekten geliştiricinindi.

Belge, gerçek akışa sadık kalacak şekilde yazıldı. Bir süreç belgesinin değeri, anlattığı sürecin denetlenebilir olmasındadır; süslenmiş bir anlatı, ilk transkript karşılaştırmasında değerini kaybeder.

---

## İnsan Kararı Olarak Kalan Diğer Mimari Tercihler

Aşağıdakiler araca sorulup kabul edilen öneriler değil, gerekçesiyle verilmiş **tasarım kararlarıdır**:

- **Bakiyede `Decimal`, `Float` değil.** Kayan nokta aritmetiği para için yuvarlama hatası üretir; 2M kullanıcıda bu sızıntı demektir. Aynı disiplin ödül matematiğinde de sürdürüldü: havuz Redis'te **kuruş cinsinden tamsayı** tutuluyor (`INCRBY`), çünkü `INCRBYFLOAT` haftada milyonlarca artışta sapma biriktirir.
- **`RewardLog` üzerinde `(userId, seasonId)` tekil kısıtı.** Dağıtım job'ının yeniden çalışması ihtimaline karşı idempotency, uygulama kodunda değil **veritabanı seviyesinde** garanti altına alındı. Redis kilidi tek başına yeterli değildir — TTL dolabilir, Redis yeniden başlayabilir; asıl güvence veritabanı kısıtıdır.
- **Bakiyenin `increment` ile güncellenmesi.** Postgres `UPDATE ... SET balance = balance + x` ifadesini satır kilidi altında atomik uygular; eşzamanlı iki ödül yazımı birbirini ezmez. `Wallet.version` alanı yalnızca yazım sayacıdır.
- **Sıralamanın Redis'te olması.** Liderlik tablosunun okuma yolu transactional veritabanında sıralama veya tarama yapmaz. Bu iddia ölçümle sınandı: 100.000 üyelik ZSET'te `ZREVRANK`, 200 üyelikle **aynı süreyi** verdi (49 ms) ve 99.000. sıradaki oyuncunun penceresi ilk 10 kadar hızlı çekildi.
- **Kimlik doğrulamanın sıfır I/O olması.** JWT guard yalnızca bellekte HMAC imza kontrolü yapar. Ölçüldü: doğrulama başına **22 mikrosaniye** — bir Redis çağrısının 2.200'de biri. Yazma yolu kimlik doğrulama yüzünden yavaşlamıyor.
- **Healthcheck'lerde gerçekçi parametreler.** `pg_isready` çağrısına `-U`/`-d` verildi; bunlar olmadan komut varsayılan kullanıcıya bakar ve veritabanı hazır değilken yanlışlıkla "hazır" raporlayabilir. Mongo için `start_period: 20s` verildi, çünkü ilk açılışta başlatma işlemi port açıldıktan sonra da devam eder.

---

## Açık Bırakılan Riskler

Doğrulama disiplininin bir parçası da, kapatılmayanı açıkça söylemektir:

- **`POST /api/rewards/distribute` erişimi.** Uç bu aşamada rol kontrolüyle korundu. (Sonraki denetim turunda case metni yeniden okunduğunda bu katmanın gereksiz olduğu görüldü ve kaldırıldı; ucun güvencesi idempotency'ye bırakıldı.)
- ~~**Neon `-pooler` endpoint'i kullanılmıyor.**~~ **Kapatıldı.** `DATABASE_URL` geliştirici tarafından pooler endpoint'ine (PgBouncer) çevrildi ve canlı olarak sınandı: interactive transaction, rollback ve tekrarlı parametreli sorgular sorunsuz çalışıyor (PgBouncer transaction mode'un klasik kırılma noktaları). 100 oyunculuk gerçek dağıtım 1.26 sn'de tamamlandı. Kazanç 400 eş zamanlı bağlantıda ölçüldü: **pooler 179 bağlantı kabul ederken direct endpoint hiçbirini kabul edemedi (0/400).**
- **Ölçümler üretim koşullarını temsil etmiyor.** Gecikme sayıları geliştirici makinesinden Frankfurt/İrlanda'daki cloud servislere alındı; RTT ~60 ms. Üretimde sunucu ve Redis aynı bölgede olur ve bu süre 1-2 ms'ye düşer.

---

## Özetle

Yapay zeka bu projede **iskelet kurma, tekrarlayan yapılandırma, ölçüm ve dokümantasyon taslağı** aşamalarında hız kazandırdı. Kod tabanını tarayarak, tek başına gözden kaçabilecek üç somut sorunu yüzeye çıkardı.

Buna karşılık direksiyon geliştiricide kaldı:

- Ekonomi modelinin kuralları (havuz katkısı, cüzdan davranışı, dağıtım tetikleme),
- Güvenlik sınırları (kimliğin nereden okunacağı, sezonun kim tarafından belirleneceği),
- Mimari sınırlar (hangi yolun hangi veri deposuna dokunacağı),
- Aracın önerilerinin reddedildiği noktalar (`audit fix --force`, teste uydurulmuş kod),
- Ve bu belgenin kendisinin gerçeğe sadık kalması

insan kararıdır. Aracın değeri, ürettiği kod kadar **ürettiği kodun nerede sorgulandığıyla** ölçülür.
