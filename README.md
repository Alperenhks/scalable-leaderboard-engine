# Scalable Leaderboard Engine

2 milyon günlük aktif kullanıcılı bir mobil idle oyun (ör. *Airport Master*) için tasarlanmış, tamamen **stateless** ve yatayda ölçeklenebilir Liderlik Tablosu API'si.

> **Durum:** Skor gönderimi, canlı liderlik tablosu, JWT kimlik doğrulaması, "3 üst / 2 alt" penceresi, haftalık ödül dağıtımı, cüzdan/ödül geçmişi ve sezon geri sayımı çalışır durumda.
>
> **Frontend geliştiricisi:** Tam API sözleşmesi için **[API.md](API.md)** — uçlar, tipler, akışlar ve kırılmaz kurallar orada.

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

`DATABASE_URL` Neon'un **pooler** (PgBouncer) endpoint'ine işaret eder — host adında `-pooler` geçer:

```
postgresql://...@ep-xxx-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require
                        ^^^^^^^
```

Sebep ölçümle doğrulanmıştır: 400 eş zamanlı bağlantı denemesinde **pooler 179 bağlantı kabul ederken, direct endpoint hiçbirini kabul edemedi (0/400).** Yatayda çoğaltılmış her instance kendi `pg.Pool`'unu tuttuğu için bu fark üretim ölçeğinde belirleyicidir.

PgBouncer transaction mode bazı kurulumlarda interactive transaction ve prepared statement'ları bozar; bu proje için sınandı ve sorun çıkmadı — ödül dağıtımının dayandığı `$transaction`, rollback ve tekrarlı parametreli sorgular sorunsuz çalışıyor.

> **DDL için not:** `prisma db push` ve doğrudan `CREATE TABLE` / `CREATE INDEX` komutları bu kurulumda pooler üzerinden sınandı ve çalıştı. Yine de uzun süren migration'larda sorun yaşarsanız, `-pooler` ekini geçici olarak kaldırıp **direct** endpoint üzerinden çalıştırmak güvenli yoldur.

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

### CORS

API'yi tarayıcıdan çağıran bir istemci (web paneli, demo arayüzü) olduğu için `main.ts` içinde CORS açıktır:

| Ayar | Değer |
| --- | --- |
| `origin` | `http://localhost:3000` ve `/^https:\/\/.*\.vercel\.app$/` |
| `methods` | `GET,HEAD,PUT,PATCH,POST,DELETE` |
| `credentials` | `true` |

İki origin bilinçli seçildi: yerel geliştirmede frontend `localhost:3000`'de çalışır, dağıtımda ise Vercel her deploy için farklı bir preview alan adı üretir (`proje-abc123.vercel.app`). Bunları tek tek listelemek her deploy'da yeni bir kod değişikliği gerektirirdi; regex bu yükü ortadan kaldırır.

Fastify adapter kullanıldığı için CORS `@fastify/cors` üzerinden işlenir — regex origin desteği buradan gelir; ek kurulum gerekmez.

> **Üretim notu:** `credentials: true` ile regex origin birlikte kullanıldığında, `*.vercel.app` altındaki **herhangi** bir site (başkasının Vercel projesi dahil) kimlik bilgisi taşıyan istek atabilir. Gerçek bir dağıtımda origin listesinin tek bir sabit alan adına daraltılması veya `ALLOWED_ORIGINS` ortam değişkeninden okunması gerekir.

### Oyuncu kimliği: login yok, "oyuncu seç" var

Case bir login akışı istemiyor ama *"players should clearly see **their own** ranking"* diyor. Bu ikisi çelişmez: sunucunun **kim olduğunu bilmesi** yeter, **kanıtlamasını istemek** gerekmez.

Çözüm **oyuncu kimliğine bürünmedir**: istemci hangi oyuncu olarak baktığını söyler, sunucu o oyuncu için imzalı bir JWT üretir. Şifre, kayıt, e-posta yoktur.

```bash
curl -X POST http://localhost:8080/api/auth/identify \
  -H 'Content-Type: application/json' -d '{"mode":"outside"}'
```

`mode` jürinin tek tıkla her senaryoyu denemesi içindir:

| mode | Ne döndürür | Hangi özelliği açar |
| --- | --- | --- |
| `top` | 1. sıradaki oyuncu | Zirve görünümü |
| `mid` | Tablonun ortası | Normal oyuncu |
| `outside` | 121. sıra (ilk 100 dışı) | **"3 üst / 2 alt" penceresi** |
| `unranked` | Bu hafta oynamamış oyuncu | `rank: null` ekranı |
| `random` | Rastgele | Genel gezinme |

`{"role":"admin"}` eklenirse admin yetkili token üretilir — ödül dağıtımını canlı denemek için.

> **Token gerçek bir JWT'dir** ve tüm korumalı uçlar onu normal guard'dan geçirir. Yani auth **mimarisi üretim kalitesindedir**; yalnızca kimliği kanıtlama adımı demo gereği atlanmıştır. Gerçek bir oyunda bu ucun yerine oyunun kendi login'i gelir, arkasındaki hiçbir şey değişmez.
>
> **Üretim notu:** `role: "admin"` alanının istemciden kabul edilmesi yalnızca demo içindir. Gerçek dağıtımda bu alan kaldırılmalı ve admin token'ı yalnızca sunucu tarafında üretilmelidir.

`GET /api/auth/players?search=&limit=&offset=` ile oyuncu listesi aranabilir — frontend'in "oyuncu seçici" ekranı bunu kullanır.

### Kimlik doğrulama ve yetkilendirme

Skor gönderimi ve oyuncuya özel okumalar `Authorization: Bearer <token>` ister.

Doğrulama **tamamen bellekte** yapılır: `.env` içindeki `JWT_SECRET` ile HMAC imza kontrolü. Ne Postgres'e ne Redis'e sorgu gider — yazma yolunun gecikmesi kimlik doğrulama yüzünden artmaz. 2M DAU'da her istekte bir kullanıcı sorgusu, bu mimarinin kaçındığı yükü geri getirirdi.

Kimlik token'ın `sub` alanından okunur; istek gövdesinden `userId` **kabul edilmez**.

#### Roller (RBAC)

Token `roles` alanı taşır. İki rol vardır:

| Rol | Yetki |
| --- | --- |
| `player` | Skor gönderme, kendi sırasını görme (varsayılan) |
| `admin` | Yukarıdakiler + ödül dağıtımını tetikleme |

Rol de token'ın içinde taşınır, veritabanında tutulmaz — yetki kontrolü de kimlik doğrulama gibi **sıfır I/O** kalır.

İki guard ayrı tutulmuştur: `JwtAuthGuard` "kimsin?" sorusunu yanıtlar (**401**), `RolesGuard` ise "bunu yapmaya yetkin var mı?" sorusunu (**403**).

`roles` taşımayan bir token sıradan oyuncu sayılır — **varsayılan daima en az yetkidir**, rolsüz bir token hiçbir koşulda admin ucuna giremez.

#### Geliştirme token'ı

Gerçek login akışı henüz yok; korumalı uçları denemek için:

```bash
node scripts/issue-token.js <userId> [username]            # player rolü
node scripts/issue-token.js <userId> [username] --admin    # admin rolü
```

`--admin` verilmedikçe token `player` rolüyle üretilir. Varsayılanın en az yetki olması bilinçlidir: yanlışlıkla admin token üretip onunla test etmek, korumanın çalıştığı yanılgısına yol açardı.

### `POST /api/score` 🔒

Oyuncunun skorunu **artırır**. `delta` bir fark değeridir, mutlak skor değil.

```json
{
  "delta": 150,
  "source": "quest_complete",
  "idempotencyKey": "order-abc-123"
}
```

| Alan | Zorunlu | Açıklama |
| --- | --- | --- |
| `delta` | evet | Tamsayı, `-1.000.000` ile `1.000.000` arası. Negatif değer ceza/düzeltme için serbesttir |
| `source` | evet | Küçük harf, rakam ve alt çizgi, ör. `idle_tick` |
| `idempotencyKey` | hayır | Verilirse tekrar gönderim çift saymaz |

Ne `userId` ne `seasonId` kabul edilir — biri token'dan, diğeri o anki ISO haftasından gelir. Gönderilirlerse istek 400 alır: aksi halde biri kimlik sahteciliğine, diğeri kapanmış bir sezona skor yazmaya açık olurdu.

Yanıt (`201`):

```json
{
  "userId": "cmsxqc9s70000r2v3uit4ajet",
  "seasonId": "2026-W34",
  "delta": 150,
  "totalScore": 10500,
  "rank": 2,
  "duplicate": false
}
```

`duplicate: true`, isteğin mevcut bir `idempotencyKey` ile kısa devre yapıldığını gösterir; `totalScore` ilk kaydın değeridir.

### `GET /api/leaderboard`

| Parametre | Varsayılan | Açıklama |
| --- | --- | --- |
| `limit` | `10` | `1`–`100`. Üst sınır bilinçlidir: sınırsız `ZREVRANGE` tek iş parçacıklı Redis'i kilitlerdi |
| `offset` | `0` | Atlanacak kayıt sayısı |
| `seasonId` | o anki hafta | `YYYY-Www`, ör. `2026-W34`. Geçmiş sezon okumaları serbesttir |

```json
{
  "seasonId": "2026-W34",
  "total": 3,
  "limit": 10,
  "offset": 0,
  "entries": [
    { "rank": 1, "userId": "cmsxqca8w0002r2v3v4ui985h", "score": 12000, "username": "gate_hero" }
  ]
}
```

### `GET /api/leaderboard/around` 🔒

**"3 üst, 2 alt" kuralı.** Oyuncu ilk 100'ün dışında kalsa bile listeden kaybolmaz.

- Oyuncu **ilk 100 içindeyse**: tablonun başı döner, `inTopWindow: true`.
- Oyuncu **ilk 100 dışındaysa**: `[sıra-3 … sıra+2]` aralığı döner — 3 üst, kendisi, 2 alt.

Kimlik token'dan alınır. Maliyet sabittir: `ZREVRANK` + dar bir `ZREVRANGE` + en fazla 6 satırlık ad araması. Oyuncunun 1.500.000. sırada olması hiçbir şeyi değiştirmez.

```json
{
  "seasonId": "2026-W34",
  "userId": "cmsxrgah80031h3v34yi6r0te",
  "rank": 110,
  "score": 89100,
  "total": 121,
  "inTopWindow": false,
  "entries": [
    { "rank": 107, "username": "player_107", "score": 89400, "isCurrentUser": false },
    { "rank": 108, "username": "player_108", "score": 89300, "isCurrentUser": false },
    { "rank": 109, "username": "player_109", "score": 89200, "isCurrentUser": false },
    { "rank": 110, "username": "player_110", "score": 89100, "isCurrentUser": true },
    { "rank": 111, "username": "player_111", "score": 89000, "isCurrentUser": false },
    { "rank": 112, "username": "player_112", "score": 88900, "isCurrentUser": false }
  ]
}
```

### `GET /api/leaderboard/rank` 🔒

Tek oyuncunun sırası ve skoru; kimlik token'dan gelir. Oyuncu o sezon tabloda yoksa `rank` **`null`** döner (`0` değil — `0` birincilik anlamına gelirdi).

```json
{ "userId": "...", "seasonId": "2026-W34", "rank": null, "score": 0 }
```

### `GET /api/rewards/pool`

Sezonun o ana kadar biriken ödül havuzu.

```json
{ "seasonId": "2026-W34", "poolAmount": "210.00" }
```

### `GET /api/rewards/season`

Sezon durumu — frontend'in geri sayımı ve ödül tablosu için tek uç. Bitiş anı **sunucuda** hesaplanır: istemcinin yerel saatine bırakılsaydı farklı saat dilimlerindeki oyuncular farklı bir sezon sonu görürdü.

```json
{
  "seasonId": "2026-W34", "isCurrentSeason": true,
  "endsAt": "2026-08-24T00:00:00.000Z", "secondsRemaining": 517436,
  "serverTime": "2026-08-18T00:16:03.885Z",
  "poolAmount": "94018764.62", "playerCount": 4950,
  "prizePoolRate": 0.02, "rewardedPlayerCount": 100,
  "distribution": { "first": 0.2, "second": 0.15, "third": 0.1, "remaining": 0.55 }
}
```

Ödül oranları da buradan yayınlanır ki frontend bunları kendi içine sabitlemek zorunda kalmasın.

### Oyuncunun kendi verileri 🔒

Case'in "haftalık ödül/durum iletişimi" gereksinimini karşılayan uçlar. Hepsi token'daki kimliğe bağlıdır; **başka bir oyuncunun cüzdanı veya ödül geçmişi hiçbir uçtan okunamaz** — sıralama herkese açıktır, para bilgisi değildir.

| Uç | Döndürdüğü |
| --- | --- |
| `GET /api/me` | Birleşik durum: sıra, skor, bakiye, son ödül |
| `GET /api/me/wallet` | Cüzdan bakiyesi ve sürüm sayacı |
| `GET /api/me/rewards` | Ödül geçmişi ve toplam kazanç |

`/api/me` bilinçli olarak birleştirilmiştir: frontend'in açılış ekranı bu verilerin hepsini birden ister, ayrı uçlara bölmek mobil bağlantıda üç ayrı gidiş-dönüş demek olurdu.

> **Para alanları daima string'dir** (`balance`, `amount`, `poolAmount`). JSON `Number`'a çevrilirse kuruş hassasiyeti kaybolur — `Decimal(18,4)` kullanılmasının sebebi de budur.

### `POST /api/rewards/distribute` 🔒 **admin**

Sezon ödüllerini dağıtır. `seasonId` verilmezse bir önceki hafta varsayılır (dağıtım bitmiş sezona uygulanır).

**Yalnızca `admin` rolü.** Para dağıtan bir uç, kimliği doğrulanmış olsa bile herkese açık olamaz: sıradan bir oyuncunun sezonu erken kapatıp ödülleri tetikleyebilmesi gerçek bir ekonomi açığıdır.

| Durum | Yanıt |
| --- | --- |
| Token yok / geçersiz | `401 Unauthorized` |
| Geçerli token, `admin` değil | `403 Forbidden` |
| `admin` | İşlem yürütülür |

```json
{
  "seasonId": "2026-W34",
  "poolAmount": "10000.00",
  "rewardedCount": 100,
  "distributedAmount": "10000.00",
  "skippedUnknownUsers": 0,
  "seasonReset": true
}
```

Zaten dağıtılmış bir sezon `409 Conflict` döner.

### Örnek istekler

```bash
TOKEN=$(node scripts/issue-token.js <CUID> oyuncu_adi)
ADMIN_TOKEN=$(node scripts/issue-token.js <CUID> yonetici --admin)

# Skor gönderimi — userId token'dan gelir, gövdede yer almaz
curl -X POST http://localhost:8080/api/score \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"delta":150,"source":"quest_complete"}'

# Idempotency — aynı anahtarla iki kez; skor ve havuz yalnızca bir kez artar
curl -X POST http://localhost:8080/api/score \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"delta":500,"source":"purchase","idempotencyKey":"order-abc-123"}'

# Liderlik tablosu ve sayfalama (kimlik istemez)
curl 'http://localhost:8080/api/leaderboard?limit=10'
curl 'http://localhost:8080/api/leaderboard?limit=5&offset=5'

# 3 üst / 2 alt penceresi
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/leaderboard/around

# Ödül havuzu (kimlik istemez)
curl http://localhost:8080/api/rewards/pool

# Manuel dağıtım — ADMIN token gerekir
curl -X POST http://localhost:8080/api/rewards/distribute \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"seasonId":"2026-W34"}'

# Aynı istek player token ile -> 403 Forbidden
curl -X POST http://localhost:8080/api/rewards/distribute \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"seasonId":"2026-W34"}'
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

Case metni 4-100 aralığı için *"distributed among players ranked 4th through 100th, **based on their rank**"* diyor. Bu ifade iki türlü okunabilir ve **sıraya değil skora oranlı** dağıtım seçildi:

| Okuma | Ne yapar | Neden seçilmedi / seçildi |
| --- | --- | --- |
| Sıra ağırlıklı (ör. ağırlık = `101 - rank`) | 4. sıradaki 5. sıradakinden hep daha çok alır, skorları eşit olsa bile | Skor farkını tamamen yok sayar; 4. oyuncu 100.'nün iki katı skor yapmışsa bu görünmez |
| **Skora oranlı (seçilen)** | Pay, oyuncunun o haftaki gerçek katkısıyla orantılı | Havuzun kaynağı skorun %2'si; havuza ne kadar katkı yaptıysan payın da o oranda olması tutarlı |

Belirleyici gerekçe: **havuz skordan doğuyor.** Havuza giren para her oyuncunun kazandığı paranın %2'si olduğuna göre, geri dağıtımın da aynı ölçüye dayanması ekonomik olarak tutarlıdır. Sıra ağırlıklı dağıtımda skoru iki kat olan bir oyuncu yalnızca bir sıra farkı kadar fazla alırdı.

Sıralamanın anlamı yine korunur: **ilk üç sıra sabit yüzdelerle (%20/%15/%10) ödüllendirilir** — orada sıra, skordan bağımsız olarak belirleyicidir. Skora oranlı bölüşüm yalnızca 4-100 kuyruğunda geçerlidir.

> Sıra ağırlıklı dağıtım tercih edilirse değişiklik tek satırdır: `reward-math.ts` içinde ağırlık `allocation.score` yerine `REWARDED_PLAYER_COUNT + 1 - allocation.rank` olur. Dağıtımın geri kalanı (havuz koruma, yuvarlama artığı) aynen çalışır.

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

Bu proje **tek bir yapay zeka aracıyla** geliştirildi: **Claude Code** (Anthropic). Başka hiçbir yardımcı IDE aracı — Copilot, Cursor, Windsurf veya benzeri bir kod tamamlama eklentisi — kullanılmadı.

### Direksiyon geliştiricide

Araç hiçbir zaman tek başına yön belirlemedi. Farklı okumaların maddi olarak farklı işe yol açacağı her noktada durup seçenekleri gerekçeleriyle sundu; **hangi yolun tutulacağına geliştirici karar verdi.**

Ekonomi ve mimari kuralların tamamı bu şekilde belirlendi:

| Karar | Geliştiricinin seçimi |
|---|---|
| Negatif delta havuzu etkilesin mi? | **Hayır** — ceza tüm oyuncuların ödül bütçesini azaltmamalı |
| Dağıtımda cüzdan bakiyesi artsın mı? | **Evet** — aynı transaction'da, ödül gerçekten ödenmiş olsun |
| Haftalık dağıtım nasıl tetiklensin? | **Cron + manuel uç**, Redis kilidiyle |
| `seasonId`'yi kim belirlesin? | **Sunucu** — istemci kapanmış sezona yazamasın |
| Skor gönderiminde `userId` doğrulansın mı? | **Hayır** — yazma yolu Postgres'e dokunmasın |
| Liderlik tablosunda username gösterilsin mi? | **Evet** — sayfa başına tek indeksli sorguyla |

İş mantığı katmanına geçilirken doğrudan kod yazılmadı: önce kod tabanı incelendi, varsayımlar canlı servislere karşı ölçüldü ve **yazılı bir plan onaya sunuldu.** Plan onaylanmadan tek satır kod yazılmadı.

### Doğrulama disiplini

Temel kural: **üretilen kod, çalıştırılarak doğrulanmadıkça "tamam" sayılmaz.** Doğrulama sözdizimi kontrolünün ötesine geçti — canlı Upstash, Atlas ve Neon'a karşı ölçüm yapıldı:

- `ZINCRBY`'nin yeni toplamı döndürdüğü ölçülerek doğrulandı (tasarımın kilit taşı)
- Idempotency'nin dayandığı **E11000** davranışı Atlas'ta gerçekten test edildi
- 100 oyuncuya gerçek dağıtım yapıldı: `10000.00` havuz → `10000.00` dağıtıldı, kuruşu kuruşuna
- "Redis ölçekten etkilenmez" iddiası **100.000 üyeye** çıkılarak sınandı: 200 üyeyle aynı süre (49 ms)
- JWT guard'ın "sıfır I/O" iddiası ölçüldü: doğrulama başına **22 mikrosaniye**

Aracın önerdiği her hamle de kabul edilmedi. `npm audit fix --force` önerisi, Prisma'yı 7.9'dan 6.12'ye düşüreceği için reddedildi; kırmızı yanan bir ödül matematiği testinde ise kod teste uydurulmak yerine **testin beklentisi** gerçek davranışa göre düzeltildi.

### Aracın yüzeye çıkardığı sorunlar

Kod tabanı taranarak üç somut sorun bulundu, teşhisleri geliştiriciye raporlandı ve düzeltmeler onaylanarak uygulandı:

1. **`MONGO_URI`'de eksik veritabanı adı** — Mongoose sessizce `test` veritabanına yazıyordu; hata vermeden, log basmadan.
2. **Prisma 7 driver adapter zorunluluğu** — uygulama Postgres'e hiç bağlanamıyordu; `prisma.config.ts` yalnızca CLI'yi kapsıyordu.
3. **Neon transaction timeout'u** — 100 oyunculuk dağıtım 200 ardışık sorgu üretip 5 sn limitini aşıyordu. Yalnızca timeout artırmak semptomu gizlerdi; `createMany` ile toplu yazıma geçildi ve süre **5.2 sn → 1.4 sn**'ye indi.

Üçüncü olayda ek bir doğrulama daha yapıldı: hata sonrası veritabanı durumu kontrol edilerek transaction'ın **temiz geri alındığı** görüldü (0 `RewardLog`, 0 `Wallet`). Atomiklik tasarımı gerçek bir hata senaryosunda sınandı ve kısmi ödeme oluşmadı.

Sürecin ayrıntılı dökümü, açık bırakılan riskler ve aracın önerisinin reddedildiği noktalar için: **[AI_WORKFLOW.md](AI_WORKFLOW.md)**

---

## Notlar

- `.agents/`, `.claude/` ve `skills-lock.json` yerel geliştirme aracı dosyalarıdır; `.gitignore` ile versiyon kontrolünün dışında tutulur ve projenin çalışması için gerekli değildir. `.gitignore` içindeki `.windsurf/` ve `.cursor/` girdileri `prisma init`'in bıraktığı jenerik yer tutuculardır — bu araçlar projede kullanılmadı, karşılık gelen klasörler hiç oluşmadı.
- `npm audit`, Prisma CLI'nin `deepmerge-ts` bağımlılığından kaynaklanan 3 adet high severity uyarısı gösterir. Bu paket yalnızca bir **devDependency**'dir (build zamanı), çalışma zamanına dahil olmaz. `npm audit fix --force` Prisma'yı 6.12'ye geri düşüreceği için uygulanmamıştır.
