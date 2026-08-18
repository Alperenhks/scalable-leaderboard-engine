# Scalable Leaderboard Engine

2 milyon günlük aktif kullanıcılı bir mobil idle oyun (ör. *Airport Master*) için tasarlanmış, tamamen **stateless** ve yatayda ölçeklenebilir Liderlik Tablosu API'si.

**▶ Canlı uygulama (arayüz):** https://scalable-leaderboard-client.vercel.app
**Canlı API:** https://scalable-leaderboard-engine.onrender.com/api
**İstemci deposu:** https://github.com/Alperenhks/scalable-leaderboard-client

> İstemci ve sunucu **ayrı depolarda** ve ayrı dağıtılır (Vercel / Render);
> bu depo yalnızca sunucuyu barındırır.

| Belge | İçerik |
|---|---|
| **[API.md](API.md)** | Tam API sözleşmesi — uçlar, tipler, örnek yanıtlar |
| **[AI_WORKFLOW.md](AI_WORKFLOW.md)** | Geliştirme süreci, verilen kararlar, açık riskler |

Skor gönderimi, canlı liderlik tablosu, JWT kimlik doğrulaması, "3 üst / 2 alt" penceresi, haftalık ödül dağıtımı, cüzdan/ödül geçmişi ve sezon geri sayımı çalışır durumdadır.

---

## İçindekiler

- [Altyapı](#altyapı--tümü-bulutta) · [Mimari](#mimari-genel-bakış) · [Kurulum](#kurulum)
- [API](#api) · [Performans](#performans--ölçülmüş) · [Ödül dağıtımı](#ödül-havuzu-ve-haftalık-dağıtım)
- [Komutlar](#komutlar) · [Veri modeli](#veri-modeli) · [Proje yapısı](#proje-yapısı)

---

## Altyapı — tümü bulutta

Hiçbir servis yerel makineye bağlı değildir; üç veri deposu da yönetilen bulut hizmetleridir. Case'in **"Cloud usage"** kriteri bu şekilde karşılanır.

| Katman | Servis | Konsol | Rol |
|---|---|---|---|
| **API (backend)** | Render | [dashboard.render.com](https://dashboard.render.com/) | NestJS uygulaması — `main` dalına push'ta otomatik deploy |
| **Arayüz (frontend)** | Vercel | [vercel.com](https://vercel.com/) | İstemci uygulaması; backend'den bağımsız dağıtılır |
| **PostgreSQL** | Neon | [console.neon.tech](https://console.neon.tech/) | Kimlik, cüzdan bakiyesi, ödül geçmişi |
| **Redis** | Upstash | [console.upstash.com/redis](https://console.upstash.com/redis) | Canlı sıralama (Sorted Set) + ödül havuzu |
| **MongoDB** | Atlas | [cloud.mongodb.com](https://cloud.mongodb.com/) | Skor event log'ları (append-only) |

İstemci ve sunucu **ayrı projelerdir** ve ayrı deploy edilir — case'in *"Client and server code should be in separate projects"* şartı gereği. Bu depo yalnızca backend'i barındırır.

Bağlantı bilgilerinin hiçbiri koda gömülü değildir; tümü `.env` üzerinden okunur ve açılışta Joi ile doğrulanır.

### Soğuk başlangıç ve iki katmanlı çözüm

Render'ın ücretsiz planı 15 dakika istek almayan servisi uykuya alır; uyanma ~50 saniye sürer. Bu bir uygulama sorunu değil, planın davranışıdır — servis uyanıkken ölçülen yanıt süresi 75-80 ms'dir. Ancak projeyi ilk kez açan biri için **ilk izlenim tam olarak o 50 saniyedir**, dolayısıyla teknik olarak açıklanabilir olması deneyimi düzeltmez.

Çözüm iki katmanlıdır ve bu kurgu ölçüm sonucu ortaya çıktı:

| Katman | Araç | Aralık | Rolü |
| --- | --- | --- | --- |
| **Birincil** | [cron-job.org](https://cron-job.org) | 5 dk | Garantili tetikleme |
| **Yedek** | GitHub Actions — [`keep-alive.yml`](.github/workflows/keep-alive.yml) | `*/5` | Birincil durursa devreye girer |

İlk kurulumda yalnızca GitHub Actions kullanılmış ve `*/10` tanımlanmıştı. Tek bir 16 dakikalık testle "çalışıyor" sanıldı; ertesi gün servisin yine uyuduğu görüldü. Sebep, `schedule` tetikleyicisinin **zamanlama garantisi vermemesiydi** — gerçek aralıklar 19-32 dakika arasında değişiyordu:

```
#2 22:57   #3 23:16 (+19)   #4 23:41 (+25)   #5 00:00 (+19)   #6 00:32 (+32)
```

15 dakikalık eşik düzenli olarak aşıldığı için servis uyumaya devam ediyordu. Birincil ping bu yüzden tetiklemeyi garanti eden harici bir zamanlayıcıya taşındı; Actions ikinci savunma hattı olarak bırakıldı.

| Karar | Gerekçe |
| --- | --- |
| **5 dakika** aralık | 15 dakikalık eşiğe üç katlı pay bırakır; bir tetikleme kaçsa bile sonraki pencereye düşer. |
| **`/` ucu** | Hiçbir veri deposuna dokunmaz. `/api/leaderboard` pinglemek Redis ve Postgres'te günde 288 gereksiz tur demek olurdu. |
| **Kota güvenli** | Render ayda 750 saat verir, bir ay en fazla 744 saattir — servis kesintisiz uyanık dursa bile limit aşılmaz. |

Doğrulandı: 20 dakika hiç istek atılmadan beklendi, ardından servis **304 ms**'de yanıt verdi (uyumuş olsaydı ~50 sn). Ücretli plana geçildiğinde bu katman gereksizleşir ve **kodda hiçbir değişiklik gerekmez**.

---

## Mimari Genel Bakış

Sistemin temel tasarım kararı, **her veri deposunun tek bir sorumluluğu olmasıdır**. Liderlik tablosunun okuma yolu transactional veritabanında sıralama veya tarama yapmaz: 2M kaydın sıralanması tamamen Redis'te gerçekleşir, Postgres'e yalnızca görüntülenen sayfadaki (en fazla 100) oyuncunun adı için tek bir indeksli birincil anahtar araması gider — maliyet sayfa boyutuyla orantılıdır, tablo boyutuyla değil. Skor **yazma** yolu ise Postgres'e hiç dokunmaz.

| Depo | Sorumluluk | Neden |
|------|-----------|-------|
| **PostgreSQL** (Prisma) | Kimlik, cüzdan bakiyesi, ödül geçmişi | Para ve denetim kaydı ACID garantisi gerektirir |
| **Redis** (ioredis) | Canlı sıralama — Sorted Set | `ZADD`/`ZREVRANK` O(log N); 2M oyuncuda tek işlemde sıra döner |
| **MongoDB** (Mongoose) | Skor event log'ları (append-only) | Sürekli akan yüksek hacimli yazımı Postgres'ten izole eder |

### Neden Redis Sorted Set?

Bir oyuncunun sırasını PostgreSQL'de `ORDER BY score DESC` + `OFFSET` ile bulmak, 2 milyon satırlık bir tabloda pratikte tablo taraması demektir. Redis Sorted Set aynı sorguyu `ZREVRANK` ile O(log N) sürede yanıtlar. Bu, ölçeklenebilirliğin tercihe bağlı bir detayı değil, temel şartıdır.

### Ülke sıralaması: filtre değil, ayrı indeks

Ülke bazlı tablo için global sıralama çekilip filtrelenmez — 2M üyede bu, tüm sıralamayı taramak demektir. Bunun yerine her ülke kendi ZSET'inde indekslenir (`lb:<sezon>:c:TR`), böylece ülke sorgusu global sorguyla **aynı** O(log N + M) maliyetinde çalışır.

Postgres şeması değişmez; ülke yalnızca Redis'te indekslenen bir görünümdür. Yazma yolu da yavaşlamaz: ülke `ZINCRBY`'si mevcut pipeline'a eklenir (ek ağ turu yok) ve ülke bilgisi Postgres'ten değil profil cache'inden okunur.

Kazanım somut: globalde 2476. sıradaki bir oyuncu ilk 100'de görünmez ama kendi ülkesinde 129/249'dur — çoğu oyuncu kendini ancak böyle bir yerde bulabilir.

### Neden stateless?

Hiçbir sıralama durumu Node process belleğinde tutulmaz — tüm durum Redis'tedir. Bu sayede API sunucusu yatayda serbestçe çoğaltılabilir; herhangi bir istek herhangi bir instance'a gidebilir, sticky session gerekmez.

### Neden Fastify?

Express yerine Fastify adapter kullanılır. İstek başına daha düşük overhead ve belirgin biçimde yüksek throughput sağlar — bu trafik hacminde ölçülebilir bir fark yaratır.

---

## Gereksinimler

- **Node.js** 20+ (geliştirme ortamı: v24.7.0)
- **Docker** ve Docker Compose (veritabanları için)

---

## Kurulum

```bash
git clone <repo-url> && cd scalable-leaderboard-engine

docker compose up -d        # Postgres + Redis + Mongo (healthcheck'li)
cp .env.example .env        # doldurun — aşağıdaki yerel değerler compose ile uyumlu
npm install
npx prisma db push          # şemayı uygula
npm run seed                # 20.000 oyuncu
npm run start:dev           # http://localhost:8080
```

`.env` için yerel değerler:

```env
DATABASE_URL=postgresql://leaderboard:leaderboard@localhost:5432/leaderboard?schema=public
REDIS_URL=redis://localhost:6379
MONGO_URI=mongodb://localhost:27017/leaderboard
JWT_SECRET=<en az 16 karakterlik rastgele bir dize>
PORT=8080
```

Hiçbir bağlantı bilgisi koda gömülü değildir; hepsi `process.env`'den okunur ve açılışta Joi ile doğrulanır — eksik bir değişken varsa sunucu anlaşılır bir hatayla durur, ilk istekte çökmez.

**Seed** üç veri deposuna birden yazar ve veri bilinçli olarak gerçekçidir: skor dağılımı üsteldir (düz rastgele değil), oyuncuların %1'i sıralama dışı bırakılır (`rank: null` senaryosu için) ve rastgelelik deterministiktir — aynı komut her çalıştığında aynı tabloyu üretir. `--players 100000` ile ölçek büyütülür, `--reset` mevcut veriyi temizler.

<details>
<summary><b>Üretim notları</b> — Neon pooler ve migration</summary>

`DATABASE_URL` Neon'un **pooler** (PgBouncer) endpoint'ine işaret etmelidir (host adında `-pooler` geçer). Ölçüldü: 400 eş zamanlı bağlantı denemesinde pooler 179 bağlantı kabul ederken direct endpoint **hiçbirini** kabul edemedi (0/400). Yatayda çoğaltılmış her instance kendi `pg.Pool`'unu tuttuğu için bu fark üretim ölçeğinde belirleyicidir. Uzun süren migration'larda `-pooler` ekini geçici olarak kaldırın; DDL için direct endpoint daha güvenlidir.

`db push` şemayı doğrudan uygular ve migration geçmişi bırakmaz — hızlı kurulum için uygundur. Gerçek bir dağıtımdan önce `npx prisma migrate dev` ile sürümlenmiş migration'lara geçilmelidir.

</details>

---

## API

Tüm iş uçları `/api` altındadır. Kök yol (`/`) sağlık kontrolü olarak prefix dışında tutulur.

### Oyuncu kimliği

Case *"players should clearly see **their own** ranking"* diyor: sunucunun isteği atanın kim olduğunu bilmesi gerekir. Bunun için oyuncu bir kez kimliğini seçer, sunucu o oyuncu için imzalı bir JWT üretir — şifre, kayıt veya login ekranı yoktur.

```bash
curl -X POST $BASE/auth/identify -H 'Content-Type: application/json' -d '{}'
```

`mode` parametresi her senaryoyu tek çağrıyla açar: `top`, `mid`, **`outside`** (ilk 100 dışı — "3 üst / 2 alt" penceresi), `unranked` (`rank: null` durumu), `random`.

> Üretilen token gerçek bir JWT'dir ve tüm korumalı uçlar onu normal guard'dan geçirir; gerçek bir oyunda bu ucun yerine oyunun kendi kimlik akışı gelir, arkasındaki hiçbir şey değişmez.

### Yetkilendirme — sıfır I/O

Doğrulama tamamen bellekte yapılır: `JWT_SECRET` ile HMAC imza kontrolü. Ne Postgres'e ne Redis'e sorgu gider — 2M DAU'da her istekte bir kullanıcı sorgusu, bu mimarinin kaçındığı yükü geri getirirdi. Ölçüldü: doğrulama başına **22 mikrosaniye**.

Kimlik token'ın `sub` alanından okunur; gövdeden `userId` kabul edilmez — aksi halde herkes başkası adına skor gönderebilirdi.

Rol tabanlı bir yetki katmanı bilinçli olarak **yoktur**: case bir yetkilendirme sistemi istemiyor ve korunması gereken bir uç bulunmuyor (haftalık dağıtım cron ile otomatik çalışır). Kullanılmayan bir RBAC altyapısı taşımak yerine kaldırıldı.

### CORS

Varsayılan olarak yerel portlar ve `*.vercel.app` adresleri kabul edilir — Vercel her deploy için yeni bir preview alan adı ürettiği için tek tek listelemek pratik değildir.

Üretimde `ALLOWED_ORIGINS` (virgülle ayrılmış) verilmelidir; tanımlıysa yalnızca o adresler kabul edilir. Varsayılan `credentials: true` ile birlikte herhangi bir Vercel sitesinin kimlik taşıyan istek atmasına izin verir, yani yalnızca geliştirme ve değerlendirme kolaylığı içindir.

### Uçlar

Tüm uçların tam sözleşmesi — istek/yanıt gövdeleri, doğrulama kuralları, örnek yanıtlar — **[API.md](API.md)** içindedir. Özet:

| Uç | Kimlik | Ne yapar |
| --- | --- | --- |
| `POST /api/auth/identify` | ➖ | Oyuncu kimliği seçer, JWT üretir |
| `GET /` | ➖ | Liveness — süreç ayakta mı (bağımlılıklara bakmaz) |
| `GET /api/health` | ➖ | Readiness — üç veri deposunu yoklar, düşükse `503` |
| `GET /api/auth/players` | ➖ | Oyuncu listesi / arama |
| `GET /api/leaderboard` | ➖ | İlk N (limit ≤ 100), `?country=TR` ile ülke sıralaması |
| `GET /api/leaderboard/around` | 🔒 | ⭐ 3 üst + kendisi + 2 alt penceresi (`?country` destekler) |
| `GET /api/leaderboard/rank` | 🔒 | Yalnızca kendi sırası |
| `POST /api/score` | 🔒 | Skoru **artırır** (delta), havuza %2 katkı |
| `GET /api/rewards/season` | ➖ | Geri sayım, havuz, dağıtım oranları |
| `GET /api/rewards/pool` | ➖ | Yalnızca havuz tutarı |
| `GET /api/rewards/projection` | ➖/🔒 | Tahmini ödüller + kendi payı |
| `POST /api/rewards/distribute` | ➖ | Dağıtımı elle tetikler (yıkıcı) — cron zaten otomatik çalışır |
| `GET /api/me` | 🔒 | Sıra + skor + bakiye + son ödül |
| `GET /api/me/wallet` | 🔒 | Cüzdan bakiyesi |
| `GET /api/me/rewards` | 🔒 | Ödül geçmişi |

Üç tasarım kararı uçların tamamını belirler:

- **`delta` mutlak skor değildir.** İstemci fark gönderir, sunucu `ZINCRBY` ile uygular — iki istemci aynı anda yazdığında kayıp güncelleme olmaz.
- **`userId` ve `seasonId` istek gövdesinde kabul edilmez.** Biri token'dan, diğeri sunucunun ISO haftasından gelir; gönderilirse `forbidNonWhitelisted` sayesinde istek `400` alır. Aksi halde biri kimlik sahteciliğine, diğeri kapanmış sezona yazmaya açık olurdu.
- **`rank: null` asla `0`'a çevrilmez.** `0` birincilik anlamına gelirdi; sıralamada yer almamak ayrı bir durumdur.
- **Dağıtım ucu kimlik doğrulaması istemez.** Case bir yetkilendirme sistemi istemiyor ve haftalık dağıtım zaten cron ile otomatiktir; `POST /api/rewards/distribute` yalnızca sezonun bitmesini beklemeden dağıtımın çalıştığını görebilmek için vardır. Ucun yıkıcılığı guard ile değil **idempotency** ile sınırlanır: aynı sezon ikinci kez dağıtılamaz (`409`) ve eşzamanlı çağrılar Redis kilidine takılır.

### Örnek istek

```bash
BASE=https://scalable-leaderboard-engine.onrender.com/api
TOKEN=$(curl -s -X POST $BASE/auth/identify \
  -H 'Content-Type: application/json' -d '{"mode":"outside"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# İlk 100 (kimlik istemez)
curl "$BASE/leaderboard?limit=10"

# 3 üst / 2 alt penceresi
curl -H "Authorization: Bearer $TOKEN" "$BASE/leaderboard/around"

# Skor gönderimi — userId token'dan gelir, gövdede yer almaz
curl -X POST "$BASE/score" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"delta":150,"source":"quest_complete"}'
```

---

## Performans — ölçülmüş

Tüm sayılar **canlı dağıtıma** karşı alınmıştır (Render + Neon + Upstash + Atlas); yerel makinede değil. Ölçüm araçları depoda: `perf/run-benchmark.sh` (autocannon) ve `perf/plot.py` (matplotlib).

### Gerçek kullanıcı deneyimi

Asıl soru şu: *oyuncu ekranı açtığında ne kadar bekliyor?*

![Tarayıcı ölçümü](perf/charts/browser.png)

Canlı frontend'den (Vercel) canlı backend'e (Render) atılan açılış istekleri: **69-76 ms**, altısı da paralel gittiği için **sayfa 76 ms'de hazır**. Case'in *"make the leaderboard instant"* isteği karşılanmış durumda; *"page freezes"* şikâyetinin karşılığı yok — hata oranı sıfır.

> Bu tablo yük testi değil, tek kullanıcının gerçek deneyimidir. Aşağıdaki yük testleri ise sunucunun **tavanını** ölçer: 50-100 eşzamanlı bağlantı altında kuyruk oluşur ve gecikme doğal olarak şişer.

### Yük altında davranış

| | |
|---|---|
| ![Ölçekleme](perf/charts/scaling.png) | ![Uçlar](perf/charts/endpoints.png) |

Verim ~117 RPS'te doygunluğa ulaşır ve gecikme oradan sonra lineer artar — klasik doygunluk eğrisi. Kırılma yok, hata yok: sistem aşırı yükte çökmez, yavaşlar. Uç bazında ise yalnızca Redis'e giden uçlar (`season`, `rank`) en hızlısıdır; `me` Postgres'ten cüzdan okuduğu için en maliyetlisi.

### Maliyet neyle orantılı?

| | |
|---|---|
| ![Sayfa boyutu](perf/charts/page-size.png) | ![Ülke sıralaması](perf/charts/country.png) |

`limit` 10'dan 100'e çıkarken maliyet **10 kat değil ~1,4 kat** artıyor: sıralama Redis'te O(log N + M) ve Postgres'e yalnızca görünen sayfanın adları için tek sorgu gidiyor. Maliyet **sayfa boyutuyla** orantılı, tablo boyutuyla değil.

Ülke sorgusu global sorgudan yavaş değil — her ülke kendi ZSET'inde indekslendiği için. "Global tabloyu çekip filtrele" yaklaşımı 2M üyede tüm sıralamayı taramak olurdu.

### Ölçüm → teşhis → düzeltme

İlk ölçümde `leaderboard` beklenenden yavaştı. Her veri deposuna tek tek bakıldı:

| İşlem | Süre |
|---|---|
| Redis `ZREVRANGE` 100 üye | 62,9 ms |
| Postgres `findMany` 100 ad | 68,2 ms |
| Postgres **`SELECT 1`** | **57,0 ms** |

`SELECT 1` bile 57 ms sürüyordu — maliyet satır sayısından değil **gidiş-dönüşün kendisinden** geliyordu. Kullanıcı adı ve ülke ise pratikte hiç değişmeyen veriler; Redis'te cache'lendi (24 saat TTL) ve `around` ucundaki iki arama tek pipeline'da birleştirildi:

| Uç | Önce | Sonra |
|---|---|---|
| `leaderboard?limit=100` | 66 RPS | **117 RPS** (+77%) |
| `around` | 77 RPS | **153 RPS** (+99%) |

### Ölçek: sıralama oyuncu sayısından etkileniyor mu?

Bu mimarinin temel iddiası, sıralama maliyetinin **oyuncu sayısıyla değil sayfa boyutuyla** orantılı olmasıdır. İddia olarak bırakılmadı — ZSET kademeli büyütülüp her adımda aynı sorgular çalıştırıldı:

| Üye sayısı | `ZREVRANK` | İlk 100 | 3 üst + 2 alt | Derin sayfa |
|---|---|---|---|---|
| 1.000 | 51,8 ms | 54,1 ms | 103,2 ms | 53,6 ms |
| 10.000 | 52,3 ms | 53,5 ms | 104,9 ms | 52,8 ms |
| 100.000 | 53,2 ms | 53,3 ms | 103,2 ms | 53,4 ms |
| 500.000 | 51,8 ms | 53,5 ms | 104,3 ms | 53,2 ms |
| **1.000.000** | **52,0 ms** | **52,3 ms** | **103,9 ms** | 117,1 ms |

**Bin kat büyümede süre değişmiyor.** Ölçülen sürenin neredeyse tamamı ağ turudur (~52 ms); sıralamanın kendi maliyeti ölçüm hassasiyetinin altında kalıyor. "3 üst + 2 alt" iki ağ turu gerektirdiği için iki katı. "Derin sayfa" sütunu, klasik `ORDER BY ... OFFSET` yaklaşımının çöktüğü yeri ölçer: tablonun sonundan 100 kayıt çekmek, başından çekmekle aynı sürüyor.

Ölçüm tekrarlanabilir:

```bash
node perf/scale-test.mjs            # 2.000.000 üyeye kadar dener
node perf/scale-test.mjs 500000     # daha küçük ölçek
```

> Test 1.360.000 üyede Upstash'in **ücretsiz plan** sınırına (anahtar başına 100 MB) takılır. Bu bir kod sınırı değil, barındırma planı sınırıdır — script bunu ayırt edip raporlar, çökmez.

#### Örnek veri neden 20.000 oyuncu?

İki ayrı soru: yukarıdaki tablo **sistemin ölçekte çalıştığını** kanıtlar, seed ise **case senaryolarının görünmesini** sağlar.

20.000 oyuncu ikincisi için yeterli — ilk 100 tablosu dolu, ilk 100 dışındaki oyuncunun "3 üst / 2 alt" penceresi çalışıyor, sırasız oyuncular (`rank: null`) var, 20 ülke tablosu dolu. Daha fazla satır bu senaryolara yeni bir şey katmaz, yalnızca kurulumu uzatır. Ölçek yine de büyütülebilir:

```bash
npm run seed -- --players 100000
```

### 2M DAU için ne gerekir?

![Kapasite](perf/charts/capacity.png)

| | |
|---|---|
| 2M DAU × günde ~8 görüntüleme | 16.000.000 istek/gün |
| Ortalama yük | ~185 RPS |
| Tepe saat (3× çarpan) | ~556 RPS |
| Ölçülen tek instance | ~117 RPS |
| **Gereken instance sayısı** | **~5** |

Bu bir darboğaz değil, **kapasite planıdır.** Mimari stateless olduğu için — hiçbir sıralama durumu process belleğinde tutulmaz — instance sayısı doğrudan çoğaltılabilir; sticky session veya oturum paylaşımı gerekmez.

Ayrıca ölçüm Render'ın **ücretsiz katmanında** (0.1 CPU) yapılmıştır. Aynı kod 8 çekirdekli bir makinede **292 RPS** üretir: yani tek instance sınırı donanımdan gelir, koddan değil.

### Ölçümü tekrarlamak

```bash
./perf/run-benchmark.sh                 # canlıya karşı yük testi
.perfvenv/bin/python perf/plot.py       # grafikleri üret
```

---

## Ödül Havuzu ve Haftalık Dağıtım

Her **pozitif** skor artışının **%2'si** sezonun ödül havuzuna aktarılır. Katkı, skor artışıyla aynı Redis pipeline'ında gider — ayrı bir gidiş-dönüş maliyeti yoktur.

Negatif delta (ceza/düzeltme) havuzu **küçültmez**: bir oyuncuya kesilen ceza, tüm oyuncuların ödül bütçesini azaltmamalıdır.

### Paylaşım

| Sıra | Pay |
| --- | --- |
| 1. | %20 |
| 2. | %15 |
| 3. | %10 |
| 4–100 | kalan %55, **sıralarına orantılı** |

4-100 aralığında ağırlık sıradan türetilir (`REWARDED_PLAYER_COUNT + 1 - rank`); skor hesaba girmez. Case'in ifadesi bunu gerektiriyor: *"distributed among players ranked 4th through 100th, **based on their rank**"*.

Skora oranlı bir dağıtım da denendi ve ölçülerek reddedildi: ilk 100'e girenlerin skorları birbirine çok yakın olduğu için (canlı veride 1,18 kat fark) ödüller de neredeyse eşitleniyordu — 4. sıra 100. sıradan yalnızca %18 fazla alıyordu. Sıra tabanlı ağırlıkta aynı fark **97 kata** çıkar ve sıralamanın 4-100 aralığında gerçek bir karşılığı olur.

Kuralın gerçekten sıraya bağlı olduğu canlı sistemde doğrulanabilir — `pay ÷ ağırlık` oranı sabit çıkar, `pay ÷ skor` çıkmaz:

| Sıra | Skor | Pay | Ağırlık (101−sıra) | Pay ÷ Ağırlık | Pay ÷ Skor |
|---|---|---|---|---|---|
| 4 | 4.530.482 | ₺4.237.730 | 97 | **43.687,94** | 0,9354 |
| 50 | 4.341.886 | ₺2.228.085 | 51 | **43.687,94** | 0,5132 |
| 100 | 4.213.747 | ₺43.688 | 1 | **43.687,93** | 0,0104 |

```bash
curl -s "$BASE/rewards/projection" | jq '.entries[] | select(.rank==4 or .rank==100)'
```

### Para hassasiyeti

Havuz Redis'te **kuruş cinsinden tamsayı** olarak tutulur (`INCRBY`). `INCRBYFLOAT` ikili kayan nokta hatası biriktirir; haftada milyonlarca artışta havuz gözle görülür şekilde sapardı.

Paylaştırma da `BigInt` ile yapılır ve yuvarlama artığı 1. oyuncuya eklenir — böylece **dağıtılan toplam havuza tam olarak eşittir**, kuruş ne kaybolur ne yoktan var olur. Bu değişmez birim testleriyle sabitlenmiştir.

### Tetikleme ve idempotency

Cron her Pazartesi **00:05 UTC** çalışır ve **biten** haftayı dağıtır. 5 dakikalık gecikme, hafta sınırında yolda olan isteklerin Redis'e yazılmasını bekler.

Mükerrer dağıtıma karşı üç katman vardır:

1. **Redis `SET NX` kilidi** — aynı anda iki instance giremez.
2. **`RewardLog(userId, seasonId)` tekil kısıtı** — veritabanı seviyesinde aynı oyuncuya iki ödeme engellenir.
3. **Ön-kontrol** — sezon zaten dağıtılmışsa hiç başlanmaz (`409`).

Kilit tek başına yeterli değildir: TTL dolması veya Redis'in yeniden başlaması kilidi düşürebilir. **Asıl güvence veritabanı kısıtıdır.**

`RewardLog` kaydı ve `Wallet.balance` artışı **tek transaction**'da yazılır; ayrı yazılsalardı araya düşen bir hata, ödül kaydı olan ama parası ödenmemiş oyuncular bırakırdı. Redis ancak Postgres'e yazıldıktan **sonra** sıfırlanır — ters sırada dağıtım yarıda kalırsa sıralama ve havuz geri getirilemezdi.

### Dağıtımı canlı denemek

Dağıtım cron ile otomatik çalışır, ama sezonun bitmesini beklemeden elle de tetiklenebilir. Uç kimlik doğrulaması istemez; yıkıcılığı idempotency ile sınırlanır (aynı sezon ikinci kez dağıtılamaz, `409` döner).

```bash
BASE=https://scalable-leaderboard-engine.onrender.com/api

# Önce: havuz ve 1. sıradaki oyuncu (adını not alın — tablo birazdan boşalacak)
curl -s "$BASE/rewards/season" | jq '{sezon:.seasonId, havuz:.poolAmount, oyuncu:.playerCount}'
curl -s "$BASE/leaderboard?limit=1" | jq -r '.entries[0].username'

# Dağıt
curl -s -X POST "$BASE/rewards/distribute" -H 'Content-Type: application/json' \
  -d "{\"seasonId\":\"$(curl -s $BASE/rewards/season | jq -r .seasonId)\"}" | jq

# Sonra: havuz ve sıralama sıfırlanmış olmalı
curl -s "$BASE/rewards/season" | jq '{havuz:.poolAmount, oyuncu:.playerCount}'

# Kazananın cüzdanı
TOKEN=$(curl -s -X POST $BASE/auth/identify -H 'Content-Type: application/json' \
  -d '{"username":"<not aldığınız ad>"}' | jq -r .token)
curl -s "$BASE/me/rewards" -H "Authorization: Bearer $TOKEN" | jq
```

> **Yıkıcıdır:** sıralama ve havuz sıfırlanır, arayüzdeki tablo boşalır. Bu case'in *"both the pool and the leaderboard reset"* maddesinin beklenen davranışıdır. Veriyi geri getirmek için `npm run seed -- --reset`.

Tetiklemeden önce sonucu görmek için `GET /api/rewards/projection` — gerçek dağıtımla **aynı** fonksiyonu kullanır, dolayısıyla tahmin ile ödenen tutar ayrışmaz.

### Tutarlılık modeli

Skor gönderimi iki veri deposuna yayılır ve aralarında ortak transaction yoktur — dağıtık atomiklik mümkün değildir. Bu yüzden sıra bilinçli seçilmiştir: **önce Redis, sonra Mongo.**

Redis canlı sıralamanın otoritesi, Mongo ise denetim kaydıdır. Mongo yazımı düşerse skor doğru kalır, yalnızca bir denetim satırı kaybolur. Ters sırada Redis düşseydi log, ödül dağıtımının dayandığı skoru yanlış gösterirdi. **Denetim satırı kaybetmek, skor kaybetmekten ucuzdur.**

Idempotency'nin doğruluk sınırı `score_events.idempotencyKey` üzerindeki `unique + sparse` index'idir. Eşzamanlı çift gönderimde index kazananı belirler; kaybeden istek Redis'e uyguladığı artışı geri alır.

---

## Komutlar

Tümü proje kök dizininden çalıştırılır.

| Komut | Açıklama |
|-------|----------|
| `npm run start:dev` | Geliştirme sunucusu (hot reload) |
| `npm run build` | Üretim derlemesi |
| `npm run start:prod` | Derlenmiş uygulamayı çalıştırır |
| `npm run lint` | ESLint (otomatik düzeltmeli) |
| `npm test` | Birim testleri |
| `npm run test:e2e` | Uçtan uca testler |
| `npx prisma studio` | Veritabanı görsel arayüzü |
| `npx prisma generate` | Prisma client'ı yeniden üretir |

Tek bir testi çalıştırmak için:

```bash
npm test -- --testNamePattern="test adı"
```

---

## Veri Modeli

### PostgreSQL (`prisma/schema.prisma`)

- **`User`** — Oyuncu kimliği. Canlı skor burada tutulmaz; skorun otoritesi Redis'tir.
- **`Wallet`** — Oyuncu bakiyesi, `User` ile 1:1. Bakiye `Decimal(18,4)` tipindedir; para alanında `Float` kullanmak kayan nokta yuvarlama hatasıyla bakiyede sızıntı yaratır. `version` alanı eşzamanlı ödül yazımlarında optimistic locking sağlar.
- **`RewardLog`** — Haftalık ödül dağıtım geçmişi. `(userId, seasonId)` üzerinde tekil kısıt vardır: dağıtım job'ı yeniden çalışsa bile bir oyuncuya aynı sezon için iki kez ödeme yapılamaz (idempotency, veritabanı seviyesinde garanti).

### MongoDB (`src/events/schemas/score-event.schema.ts`)

- **`ScoreEvent`** — Append-only skor olayları: kim, ne kadar, hangi sezonda, hangi kaynaktan. `idempotencyKey` üzerinde tekil sparse index ile tekrar gönderimlerde çift sayım engellenir.

---

## Proje Yapısı

Bu depo yalnızca backend'i barındırır; kaynak kod ayrı bir alt klasöre gömülmeden doğrudan kök dizindedir.

```
.
├── docker-compose.yml       # Postgres + Redis + Mongo (healthcheck'li)
├── README.md
├── AI_WORKFLOW.md           # Geliştirme sürecinin ve karar noktalarının kaydı
├── .env.example
├── prisma.config.ts         # DATABASE_URL'i process.env'den okur
├── API.md                   # Frontend için tam API sözleşmesi
├── prisma/
│   ├── schema.prisma        # PostgreSQL şeması
│   └── seed.ts              # Örnek veri üreticisi (üç depoya birden yazar)
├── perf/                    # Yük testi + grafik üretimi
│   ├── run-benchmark.sh     # autocannon senaryoları (canlıya karşı)
│   ├── plot.py              # matplotlib grafikleri
│   ├── results/             # ham ölçüm çıktıları (JSON)
│   └── charts/              # README'ye gömülen PNG'ler
├── scripts/
│   └── issue-token.js       # CLI'dan JWT üretici (HTTP alternatifi: /api/auth/identify)
└── src/
    ├── main.ts / app.module.ts
    ├── infrastructure/      # Prisma, Redis, .env doğrulaması
    ├── leaderboard/         # Canlı sıralama — sistemin kalbi
    ├── rewards/             # Havuz, dağıtım, cron, ödül matematiği
    ├── auth/                # JWT guard, kimlik seçimi
    ├── players/             # Cüzdan, ödül geçmişi
    ├── health/              # Liveness + readiness
    ├── events/              # Skor event log'u (Mongo)
    └── common/              # Sezon hesabı, paylaşılan decorator'lar
```

Her özellik modülü kendi içinde aynı deseni izler:

```
leaderboard/
├── controllers/   # HTTP yüzeyi
├── services/      # iş mantığı
├── dto/           # girdi doğrulaması
└── tests/         # birim testleri
```

`infrastructure/` ayrıdır çünkü Prisma, Redis ve ortam doğrulaması bir *özellik* değil, tüm özelliklerin üzerinde durduğu zemindir. `rewards/domain/` içindeki para matematiği de hiçbir veri deposuna bağlı değildir — ayrı durur ve doğrudan test edilir.

---

## AI Workflow

Proje **tek bir yapay zeka aracıyla** geliştirildi: **Claude Code**. Başka hiçbir kod tamamlama eklentisi kullanılmadı.

Temel çalışma kuralı: *üretilen kod, çalıştırılarak doğrulanmadıkça "tamam" sayılmaz.* Araç yön belirlemedi — mimari ve ekonomi kararlarının tamamı geliştirici tarafından verildi, aracın bazı önerileri (ör. `npm audit fix --force`) gerekçeli olarak reddedildi.

Sürecin tam dökümü — verilen kararlar, canlı servislere karşı yapılan doğrulamalar, aracın yakaladığı üç somut hata ve açık bırakılan riskler:

**→ [AI_WORKFLOW.md](AI_WORKFLOW.md)**

---

## Notlar

- `.agents/`, `.claude/` ve `skills-lock.json` yerel geliştirme aracı dosyalarıdır; `.gitignore` ile versiyon kontrolünün dışında tutulur ve projenin çalışması için gerekli değildir. `.gitignore` içindeki `.windsurf/` ve `.cursor/` girdileri `prisma init`'in bıraktığı jenerik yer tutuculardır — bu araçlar projede kullanılmadı, karşılık gelen klasörler hiç oluşmadı.
- `npm audit`, Prisma CLI'nin `deepmerge-ts` bağımlılığından kaynaklanan 3 adet high severity uyarısı gösterir. Bu paket yalnızca bir **devDependency**'dir (build zamanı), çalışma zamanına dahil olmaz. `npm audit fix --force` Prisma'yı 6.12'ye geri düşüreceği için uygulanmamıştır.
