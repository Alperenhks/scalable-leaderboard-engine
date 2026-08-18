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

### Soğuk başlangıç ve nasıl çözüldüğü

Backend, Render'ın **ücretsiz** planında çalışır ve bu planın bilinen bir davranışı vardır: 15 dakika istek almayan servis uykuya alınır, sonraki ilk istek konteyner ayağa kalkarken **~50 saniye** bekler.

Bu bir uygulama sorunu değildi — servis uyanıkken ölçülen yanıt süresi 75-80 ms'dir (bkz. [Performans](#performans--ölçülmüş)) — ama projeyi ilk kez açan biri için **ilk izlenim tam olarak o 50 saniyedir.** Teknik olarak açıklanabilir olması, deneyimi düzeltmez.

**Çözüm:** `.github/workflows/keep-alive.yml` her 10 dakikada bir sağlık ucuna istek atar; Render'ın boştalık sayacı hiçbir zaman 15 dakikaya ulaşmaz ve servis sürekli uyanık kalır.

| Karar | Gerekçe |
| --- | --- |
| **10 dakika** aralık | GitHub Actions'ın `schedule` tetikleyicisi garantili değildir ve yoğun saatlerde birkaç dakika gecikebilir. 5 dakikalık pay, gecikmeye rağmen 15 dakikalık pencerenin içinde kalmayı sağlar. |
| **`/` ucu** | Hiçbir veri deposuna dokunmaz. `/api/leaderboard` pinglemek Redis ve Postgres'te günde 144 gereksiz tur demek olurdu. |
| **Kota güvenli** | Render ayda 750 saat verir, bir ay en fazla 744 saattir — tek servis kesintisiz uyanık dursa bile limit aşılmaz. |

Ücretli plana geçildiğinde bu workflow gereksizleşir ve silinebilir; **kodda hiçbir değişiklik gerekmez** — uyku, planın bir özelliğidir, uygulamanın değil.

#### Arayüz tarafındaki karşılığı

Frontend yine de bu duruma karşı dayanıklı yazılmıştır: veriler gelene kadar iskelet (skeleton) ekranı gösterir ve bekleme uzarsa "sunucu uyandırılıyor" mesajına geçer. Ping mekanizması bir sebeple durursa bile boş ekranla karşılaşılmaz.

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

### 1. Depoyu klonlayın

```bash
git clone <repo-url>
cd scalable-leaderboard-engine
```

### 2. Veritabanlarını başlatın

Üç veritabanı da Docker Compose ile gelir; ayrıca kurulum gerekmez.

```bash
docker compose up -d
```

Tüm servislerde **healthcheck** tanımlıdır. Servislerin gerçekten hazır olduğunu görmek için:

```bash
docker compose ps
```

Üç servisin de `healthy` durumuna gelmesini bekleyin (ilk açılışta Mongo ~20 sn sürebilir).

### 3. Ortam değişkenlerini ayarlayın

```bash
cp .env.example .env
```

`.env` dosyasını doldurun. `docker-compose.yml` ile uyumlu yerel değerler:

```env
DATABASE_URL=postgresql://leaderboard:leaderboard@localhost:5432/leaderboard?schema=public
REDIS_URL=redis://localhost:6379
MONGO_URI=mongodb://localhost:27017/leaderboard
JWT_SECRET=<en az 16 karakterlik rastgele bir dize>
PORT=8080
```

> Hiçbir bağlantı bilgisi koda gömülü değildir. Tüm servisler bu değerleri `process.env` üzerinden okur ve uygulama açılışında doğrular — eksik bir değişken varsa sunucu anlaşılır bir hatayla durur, ilk istekte çökmez.

### 4. Bağımlılıkları kurun

```bash
npm install
```

### 5. Veritabanı şemasını uygulayın

```bash
npx prisma db push
```

> `db push` şemayı doğrudan uygular ve migration geçmişi bırakmaz — hızlı kurulum
> ve geliştirme için uygundur. Gerçek bir dağıtımdan önce `npx prisma migrate dev`
> ile sürümlenmiş migration'lara geçilmelidir.

#### Neon kullanıyorsanız: pooler endpoint'i

`DATABASE_URL` Neon'un **pooler** (PgBouncer) endpoint'ine işaret etmelidir — host adında `-pooler` geçer.

Sebep ölçümle doğrulandı: 400 eş zamanlı bağlantı denemesinde **pooler 179 bağlantı kabul ederken direct endpoint hiçbirini kabul edemedi (0/400).** Yatayda çoğaltılmış her instance kendi `pg.Pool`'unu tuttuğu için bu fark üretim ölçeğinde belirleyicidir.

> Uzun süren migration'larda sorun yaşarsanız `-pooler` ekini geçici olarak kaldırın; DDL için direct endpoint daha güvenlidir.

### 6. Örnek veriyi yükleyin

```bash
npm run seed                      # 5.000 oyuncu (~30 sn)
npm run seed -- --players 50000   # daha büyük ölçek
npm run seed -- --reset           # önce mevcut örnek veriyi temizler
```

Seed üç veri deposunun **hepsine** yazar: Postgres'e oyuncu kimlikleri, Redis'e canlı sıralama ve ödül havuzu, Mongo'ya temsili event log'ları.

Üretilen veri bilinçli olarak gerçekçidir:

- **Skor dağılımı üsteldir** — az sayıda çok yüksek skorlu oyuncu, geniş bir orta kitle, uzun bir kuyruk. Düz rastgele dağılım tabloyu yapay gösterirdi.
- **Oyuncuların %1'i sıralama dışı bırakılır** — "bu hafta hiç oynamamış oyuncu" (`rank: null`) senaryosu ancak böyle test edilebilir. Herkese skor verilseydi bu kod yolu hiç görünmezdi.
- **Rastgelelik deterministiktir** (sabit tohumlu mulberry32) — aynı komut her çalıştığında aynı tabloyu üretir, hata bildirimi tekrarlanabilir olur.

### 7. Sunucuyu başlatın

```bash
npm run start:dev
```

Sunucu `http://localhost:8080` adresinde çalışır.

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

Kimlik token'ın `sub` alanından okunur; gövdeden `userId` kabul edilmez. Roller de (`player` / `admin`) token içinde taşınır, veritabanında tutulmaz.

İki guard ayrı tutulmuştur: `JwtAuthGuard` *"kimsin?"* sorusunu yanıtlar (**401**), `RolesGuard` *"bunu yapmaya yetkin var mı?"* sorusunu (**403**). `roles` taşımayan token sıradan oyuncu sayılır — **varsayılan daima en az yetkidir.**

### CORS

`localhost:3000` (Next.js), `localhost:5173` (Vite), bunların `127.0.0.1` karşılıkları ve tüm `*.vercel.app` alan adları kabul edilir; `credentials: true` açıktır.

Vercel her deploy için farklı bir preview alan adı ürettiğinden tek tek listelemek her dağıtımda kod değişikliği gerektirirdi; regex bu yükü kaldırır. Fastify adapter'da CORS `@fastify/cors` üzerinden işlenir, regex desteği oradan gelir.

> **Üretim notu:** `credentials: true` ile regex origin birlikte kullanıldığında `*.vercel.app` altındaki herhangi bir site kimlik bilgisi taşıyan istek atabilir. Gerçek dağıtımda origin listesi sabit bir alan adına daraltılmalı veya `ALLOWED_ORIGINS` ortam değişkeninden okunmalıdır.

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
| `POST /api/rewards/distribute` | 🔒 admin | Dağıtımı elle tetikler (yıkıcı) — cron zaten otomatik çalışır |
| `GET /api/me` | 🔒 | Sıra + skor + bakiye + son ödül |
| `GET /api/me/wallet` | 🔒 | Cüzdan bakiyesi |
| `GET /api/me/rewards` | 🔒 | Ödül geçmişi |

Üç tasarım kararı uçların tamamını belirler:

- **`delta` mutlak skor değildir.** İstemci fark gönderir, sunucu `ZINCRBY` ile uygular — iki istemci aynı anda yazdığında kayıp güncelleme olmaz.
- **`userId` ve `seasonId` istek gövdesinde kabul edilmez.** Biri token'dan, diğeri sunucunun ISO haftasından gelir; gönderilirse `forbidNonWhitelisted` sayesinde istek `400` alır. Aksi halde biri kimlik sahteciliğine, diğeri kapanmış sezona yazmaya açık olurdu.
- **`rank: null` asla `0`'a çevrilmez.** `0` birincilik anlamına gelirdi; sıralamada yer almamak ayrı bir durumdur.
- **Admin token istek gövdesinden alınamaz.** `POST /api/auth/identify` yalnızca sunucudaki `ADMIN_SECRET` ile eşleşen bir sır sunulduğunda admin token üretir; değişken tanımlı değilse hiç üretmez. Case kimlik doğrulama istemiyor, ancak para dağıtan bir ucun herkese açık olması ayrı bir sorundur — haftalık dağıtım zaten cron ile otomatiktir, bu uç yalnızca dağıtımın elle gösterilebilmesi içindir.

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

### Eşzamanlılık altında davranış

![Ölçekleme](perf/charts/scaling.png)

Verim ~117 RPS'te doygunluğa ulaşıyor ve gecikme oradan sonra lineer artıyor — klasik doygunluk eğrisi. Kırılma yok, hata yok: sistem aşırı yükte çökmüyor, sadece yavaşlıyor.

### Uç bazında verim

![Uçlar](perf/charts/endpoints.png)

Yalnızca Redis'e giden uçlar (`season`, `rank`) beklendiği gibi en hızlısı. `leaderboard` ve `around` ek olarak ad çözümlemesi yapar; `me` ise Postgres'ten cüzdan ve ödül kaydı okuduğu için en maliyetli olanıdır.

### Sayfa boyutunun maliyeti

![Sayfa boyutu](perf/charts/page-size.png)

`limit` 10'dan 100'e çıkarken maliyet **10 kat değil ~1.4 kat** artıyor. Sıralama Redis'te O(log N + M) olduğu ve Postgres'e yalnızca görünen sayfanın adları için tek sorgu gittiği için maliyet sayfa boyutuyla orantılıdır, tablo boyutuyla değil.

### Ülke sıralaması: ayrı indeks, filtre değil

![Ülke sıralaması](perf/charts/country.png)

Ülke sorgusu global sorgudan **yavaş değil, daha hızlı** — çünkü her ülke kendi Redis ZSET'inde indekslenir. "Global tabloyu çekip ülkeye göre ele" yaklaşımı 2M üyede tüm sıralamayı taramak demek olurdu; ayrı ZSET ile maliyet aynı O(log N + M) kalır ve küme küçüldüğü için bir tık daha iyi ölçülür.

Yazma yolu da yavaşlamaz: ülke `ZINCRBY`'si mevcut pipeline'a eklenir (ek ağ turu yok) ve ülke bilgisi Postgres'ten değil profil cache'inden okunur.

### Profil cache'i: ölçüm → teşhis → düzeltme

İlk ölçümde `leaderboard` beklenenden yavaştı. Teşhis için her veri deposuna tek tek gecikme ölçüldü:

| İşlem | Süre |
|---|---|
| Redis `ZREVRANGE` 100 üye | 62.9 ms |
| Postgres `findMany` 100 ad | 68.2 ms |
| Postgres **`SELECT 1`** | **57.0 ms** |

`SELECT 1` bile 57 ms sürüyordu — yani maliyet satır sayısından değil, **gidiş-dönüşün kendisinden** geliyordu. Kullanıcı adı ve ülke ise pratikte hiç değişmeyen veriler.

Çözüm: profiller Redis'te cache'lenir (24 saat TTL) ve `around` ucundaki iki ayrı arama tek pipeline'da birleştirilir.

| Uç | Önce | Sonra | Kazanç |
|---|---|---|---|
| `leaderboard?limit=100` | 66 RPS | **117 RPS** | +77% |
| `around` | 77 RPS | **153 RPS** | +99% |

TTL sonsuz değildir: bir ad değişikliği en geç bir gün içinde yansır.

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
| 4–100 | kalan %55, **skorlarıyla orantılı** |

#### "based on their rank" ifadesinin yorumu

Case metni 4-100 aralığı için *"distributed among players ranked 4th through 100th, **based on their rank**"* diyor. İfade skoru değil **sırayı** işaret ediyor ve uygulama birebir bunu yapıyor: ağırlık `REWARDED_PLAYER_COUNT + 1 - rank` ile sıradan türetilir, skor hesaba hiç girmez.

Skora oranlı bir dağıtım da denendi ve **ölçülerek reddedildi.** Gerekçe teorik değil, canlı veriden:

| | Skora oranlı | Sıraya oranlı (seçilen) |
| --- | --- | --- |
| 4. sıranın payı | ₺585.957 | ₺1.055.313 |
| 100. sıranın payı | ₺497.536 | ₺10.880 |
| **4. / 100. oranı** | **1,2x** | **97x** |

Sorun şu: ilk 100'e girenlerin skorları birbirine çok yakın (canlı veride en yüksek 4.434.015, en düşük 3.764.923 — yalnızca **1,18 kat** fark). Skora oranlı dağıtımda bu yakınlık ödüllere de yansıyor ve 4. sıradaki oyuncu 100. sıradakinden yalnızca **%18** fazla alıyor. Yani sıralamanın 4-100 aralığında pratik bir karşılığı kalmıyor — oysa rekabetçi bir liderlik tablosunda ödülün asıl işlevi tam olarak bu farkı görünür kılmak.

Sıra tabanlı ağırlıkta pay doğrusal azalır: 4. sıra en yüksek, 100. sıra en düşük payı alır ve aradaki her sıra bir öncekinden ölçülebilir biçimde daha azını alır.

İlk üç sıra bu kuraldan bağımsızdır; onlar case'in verdiği sabit yüzdelerle (%20/%15/%10) ödüllendirilir.

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
    ├── common/              # Sezon (ISO hafta) yardımcıları
    ├── config/              # .env doğrulama şeması
    ├── prisma/              # PrismaService (global modül)
    ├── redis/               # Redis client sağlayıcısı (global modül)
    ├── auth/                # JWT guard, RolesGuard, @CurrentUser + kimlik seçimi
    ├── events/              # Mongoose skor event şeması + EventsService
    ├── leaderboard/         # ZSET servisi, controller, DTO'lar
    ├── players/             # Oyuncunun kendi verileri: cüzdan, ödül geçmişi
    ├── rewards/             # Ödül matematiği, dağıtım servisi, cron, sezon durumu
    ├── app.module.ts        # Üç veri deposunun bağlandığı kök modül
    └── main.ts              # Fastify bootstrap + CORS
```

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
