# API Sözleşmesi — Frontend Rehberi

Bu doküman frontend'in ihtiyaç duyduğu her şeyi içerir: uçlar, tipler, akışlar ve tasarım notları. Backend tarafında bu sözleşmenin dışında bir şey yoktur.

**Base URL (canlı):** `https://scalable-leaderboard-engine.onrender.com/api`
**Yerel:** `http://localhost:8080/api`

---

## 0. Sağlık uçları

İki ayrı soru ayrı uçlarla yanıtlanır; karıştırılmaları pahalıya mal olur.

### `GET /` — liveness (süreç ayakta mı?)

Bağımlılıklara **bakmaz**, sıfır I/O. Global `/api` önekinden muaftır.

```json
{ "status": "ok", "uptimeSeconds": 1462 }
```

Bakmamasının sebebi: Postgres'in geçici bir kesintisi tüm filoyu yeniden
başlatırdı — oysa süreçlerde sorun yoktur ve yeniden başlatmak kesintiyi
yalnızca uzatır.

### `GET /api/health` — readiness (istek alabilir durumda mı?)

Üç veri deposunu da **paralel** yoklar; her yoklamanın 2 sn zaman aşımı vardır,
böylece yanıt vermeyen bir depo ucu asılı bırakmaz.

```json
{
  "status": "ok",
  "uptimeSeconds": 1462,
  "timestamp": "2026-08-18T20:24:26.229Z",
  "dependencies": {
    "postgres": { "status": "up", "latencyMs": 636 },
    "redis":    { "status": "up", "latencyMs": 57 },
    "mongo":    { "status": "up", "latencyMs": 74 }
  }
}
```

| Durum | HTTP | `status` |
| --- | --- | --- |
| Üç depo da ayakta | `200` | `ok` |
| En az biri erişilemez | `503` | `degraded` |

Düşük bağımlılık raporda `{"status":"down","error":"..."}` olarak görünür;
diğerleri normal raporlanmaya devam eder — rapor sorunu **izole eder**.
`503`, yük dengeleyicinin instance'ı havuzdan çıkarması için gereken makine
tarafından okunabilir sinyaldir.

---

## 1. Oyuncu kimliği

Case *"players should clearly see **their own** ranking"* diyor: `/leaderboard/around` gibi uçlar "**benim** sıram" sorusunu yanıtladığı için sunucunun isteği atanın kim olduğunu bilmesi gerekir.

Oyuncu bir kez kimliğini seçer, backend o oyuncu için imzalı bir JWT üretir. **Şifre, kayıt veya login ekranı yoktur** — frontend açılışta bu ucu bir kez çağırır, kullanıcı hiçbir şey yapmaz.

> **Önemli:** Token gerçek bir JWT'dir ve tüm korumalı uçlar onu normal guard'dan geçirir. Yani **auth mimarisi üretim kalitesindedir**; yalnızca "kimliği kanıtlama" adımı demo gereği atlanmıştır. Gerçek bir oyunda bu ucun yerine oyunun kendi kimlik akışı gelir, arkasındaki hiçbir şey değişmez.

### `POST /api/auth/identify`

Gövde **tamamen opsiyoneldir** — boş `{}` gönderirsen rastgele bir oyuncu döner. Frontend hiçbir ön bilgi olmadan çalışmaya başlayabilir.

```jsonc
// İstek — üç kullanım biçimi
{}                                    // rastgele oyuncu
{ "username": "demo_neon_pilot_5" }   // belirli oyuncu
{ "mode": "outside" }                 // senaryoya göre oyuncu
```

**`mode` değerleri — jürinin tek tıkla her senaryoyu denemesi için:**

| mode | Ne döndürür | Hangi özelliği test eder |
| --- | --- | --- |
| `top` | 1. sıradaki oyuncu | Zirve görünümü, "ilk 100 içindeyim" hali |
| `mid` | Tablonun ortası | Normal oyuncu deneyimi |
| `outside` | **121. sıra** (ilk 100'ün dışı) | ⭐ **Asıl senaryo:** "3 üst + ben + 2 alt" penceresi |
| `unranked` | Bu hafta hiç oynamamış oyuncu | `rank: null` durumu — "henüz sıralamada değilsin" ekranı |
| `random` | Rastgele | Genel gezinme |

```jsonc
// Yanıt 201
{
  "token": "eyJhbGciOiJIUzI1NiIs...",   // Authorization: Bearer <token>
  "userId": "cmsxwrb3s00046dv371a8txrx",
  "username": "demo_turbo_falcon_220",
  "roles": ["player"],
  "rank": 121,        // null olabilir (unranked)
  "score": 3696088,
  "seasonId": "2026-W34"
}
```

Yanıt `rank` ve `score` de taşır: frontend açılışta ikinci bir istek atmadan "sen 121. sıradasın" diyebilir.

### `GET /api/auth/players?search=&limit=20&offset=0`

Oyuncu seçici ekranı için arama/listeleme. `search` kullanıcı adında geçen metni arar (büyük/küçük harf duyarsız).

```jsonc
{
  "total": 5003, "limit": 20, "offset": 0,
  "players": [{ "id": "cmsx...", "username": "demo_neon_pilot_5", "country": "TR" }]
}
```

### Önerilen frontend akışı

```
Açılış → POST /api/auth/identify {}          → token'ı sakla (localStorage)
       → GET  /api/leaderboard?limit=100     → ilk 100 tablosu
       → GET  /api/leaderboard/around        → kendi penceresi
       → GET  /api/rewards/season            → geri sayım + havuz

"Oyuncu değiştir" → GET /api/auth/players    → seçim
                  → POST /api/auth/identify { username }  → yeni token
```

Token 7 gün geçerlidir. `401` alırsan `identify`'ı tekrar çağır.

---

## 2. Liderlik tablosu

### `GET /api/leaderboard?limit=100&offset=0&seasonId=`

Kimlik **gerektirmez** — herkese açık.

| Parametre | Varsayılan | Sınır |
| --- | --- | --- |
| `limit` | `10` | `1`–`100` |
| `offset` | `0` | `0`–`1.000.000` |
| `seasonId` | o anki hafta | `YYYY-Www` |

```jsonc
{
  "seasonId": "2026-W34", "total": 4950, "limit": 100, "offset": 0,
  "entries": [
    { "rank": 1, "userId": "cmsx...", "username": "demo_neon_pilot_5", "score": 4526619, "country": "TR" }
  ]
}
```

`total` sayfalama için ZCARD'dan gelir — O(1), tablo ne kadar büyürse büyüsün maliyeti değişmez.

### `GET /api/leaderboard/around` 🔒 — **case'in can alıcı özelliği**

Oyuncu ilk 100'ün dışındaysa bile kaybolmaz.

- **İlk 100 içindeyse:** tablonun başı döner, `inTopWindow: true`
- **İlk 100 dışındaysa:** `[sıra-3 … sıra+2]` = **tam 6 kayıt**, `inTopWindow: false`

```jsonc
{
  "seasonId": "2026-W34", "userId": "cmsx...", "rank": 121, "score": 3696088,
  "total": 4950, "inTopWindow": false,
  "neighbours": [ /* 3 üst + sen + 2 alt — aşağıya bakınız */ ],
  "entries": [
    { "rank": 118, "username": "demo_royal_falcon_173",  "score": 3702117, "country": "DE", "isCurrentUser": false },
    { "rank": 119, "username": "demo_shadow_phoenix_84", "score": 3701803, "country": "BR", "isCurrentUser": false },
    { "rank": 120, "username": "demo_neon_ranger_223",   "score": 3696352, "country": "US", "isCurrentUser": false },
    { "rank": 121, "username": "demo_turbo_falcon_220",  "score": 3696088, "country": "RU", "isCurrentUser": true  },
    { "rank": 122, "username": "demo_lucky_pilot_289",   "score": 3695344, "country": "JP", "isCurrentUser": false },
    { "rank": 123, "username": "demo_blazing_hawk_243",  "score": 3694181, "country": "TR", "isCurrentUser": false }
  ]
}
```

**`neighbours` — daima kendi çevren (yeni)**

`entries`den bağımsız, **her zaman** kişiye özel bir alan: 3 üst + sen + 2 alt. Oyuncu ilk 100'ün içinde olsa bile dolu gelir.

Tablonun sınırlarında **kırpılır** — uydurma satır üretilmez:

| Sıra | Üstünde | Altında | Toplam |
| --- | --- | --- | --- |
| 1. | 0 | 2 | 3 kayıt |
| 2. | 1 | 2 | 4 kayıt |
| 3. | 2 | 2 | 5 kayıt |
| 4. ve sonrası | 3 | 2 | 6 kayıt |
| Sondan 2. | 3 | 1 | 5 kayıt |
| Son | 3 | 0 | 4 kayıt |

```jsonc
// 1. sıradaki oyuncu — üstünde kimse yok
"neighbours": [
  { "rank": 1, "username": "demo_neon_pilot_5",   "score": 4526619, "isCurrentUser": true  },
  { "rank": 2, "username": "demo_cosmic_baron_20","score": 4475927, "isCurrentUser": false },
  { "rank": 3, "username": "demo_neon_baron_40",  "score": 4456299, "isCurrentUser": false }
]
```

Oyuncunun sırası yoksa (`rank: null`) `neighbours` **boş dizidir**.

> ⚠️ Uzunluğu 3-6 arasında değişir, **sabit varsayma**. Kendi satırını bulmanın tek güvenilir yolu `isCurrentUser`.

**Frontend notları:**
- `isCurrentUser: true` olan satırı görsel olarak vurgula — bu özelliğin bütün amacı bu.
- **`neighbours` kullan**, kendi çevreni göstermek için: ilk 100'de olsun olmasın hep doğru çalışır.
- `inTopWindow: true` ise ayrı bir "senin sıran" bölümü göstermeye gerek yok, oyuncu zaten listede.
- `rank: null` ise oyuncu bu hafta hiç oynamamış: pencere yerine tablonun başı döner. "Skor gönder, sıralamaya gir" mesajı için doğru an.
- Oyuncu tablonun son 2 sırasındaysa 6 yerine 5 veya 4 kayıt gelebilir (aşağıda kimse yok) — liste uzunluğunu sabit varsayma.

### Ülke sıralaması — `?country=TR`

`leaderboard` ve `around` uçlarının ikisi de `country` parametresi alır. Verilirse sıralama o ülkeyle **sınırlanır**: sıra numaraları o ülke içinde 1'den başlar.

```bash
GET /api/leaderboard?country=TR&limit=100      # TR'nin ilk 100'ü
GET /api/leaderboard/around?country=TR         # TR içindeki kendi çevren
```

```jsonc
{
  "seasonId": "2026-W34",
  "country": "TR",          // global sorguda null
  "total": 256,             // TR'deki toplam oyuncu
  "entries": [
    { "rank": 1, "username": "demo_neon_pilot_5", "score": 4526619, "country": "TR" }
  ]
}
```

**Neden bu özellik değerli:** global tabloda 2476. sırada olan bir oyuncu ilk 100'de görünmez — ama kendi ülkesinde **129/249** olabilir. Ülke sekmesi, çoğu oyuncunun kendini bir yerde görmesini sağlar.

```jsonc
// GET /api/leaderboard/around?country=RU  (globalde 2476. olan oyuncu)
{
  "country": "RU", "rank": 129, "total": 249,
  "neighbours": [
    { "rank": 126, "username": "demo_royal_tycoon_2462",  "isCurrentUser": false },
    { "rank": 127, "username": "demo_iron_tiger_2400",    "isCurrentUser": false },
    { "rank": 128, "username": "demo_frost_phoenix_2579", "isCurrentUser": false },
    { "rank": 129, "username": "demo_lucky_comet_2387",   "isCurrentUser": true  },
    { "rank": 130, "username": "demo_swift_comet_2549",   "isCurrentUser": false },
    { "rank": 131, "username": "demo_neon_ranger_2594",   "isCurrentUser": false }
  ]
}
```

| Kural | |
| --- | --- |
| Biçim | ISO 3166-1 alpha-2, iki harf (`TR`, `us` — büyük/küçük fark etmez) |
| Geçersiz değer | `400` — `"country ISO 3166-1 alpha-2 olmalıdır"` |
| Bilinmeyen ülke | `200`, boş liste (`total: 0`) |
| Yanıttaki `country` | Sorgulanan ülke; global sorguda `null` |

**Performans:** ülke sorgusu global sorgu kadar hızlıdır — her ülke için ayrı bir Redis ZSET tutulur, global tablo taranıp filtrelenmez. Ölçüldü: global 271 RPS / ülke 292 RPS (ülke kümesi daha küçük olduğu için bir tık hızlı).

> Kullanıcının kendi ülkesi `GET /api/me` yanıtındaki `country` alanından alınır.

### `GET /api/leaderboard/rank?seasonId=` 🔒

Tabloyu çekmeden yalnızca kendi sırası. Polling için ucuz.

```jsonc
{ "userId": "cmsx...", "seasonId": "2026-W34", "rank": 121, "score": 3696088 }
```

`rank` **`null` olabilir** ve bu `0` demek değildir — `0` birincilik anlamına gelirdi.

---

## 3. Skor gönderimi

### `POST /api/score` 🔒

```jsonc
// İstek
{ "delta": 150, "source": "quest_complete", "idempotencyKey": "order-abc-123" }
```

| Alan | Zorunlu | Kural |
| --- | --- | --- |
| `delta` | ✅ | Tamsayı, `-1.000.000` … `1.000.000`. **Fark değeri**, mutlak skor değil |
| `source` | ✅ | Yalnızca `[a-z0-9_]`, 1-64 karakter |
| `idempotencyKey` | ➖ | 8-128 karakter. Verilirse tekrar gönderim çift saymaz |

> ⚠️ `userId` ve `seasonId` gövdede **gönderilmez** — gönderilirse istek `400` alır. Kimlik token'dan, sezon sunucudan gelir.

```jsonc
// Yanıt 201
{ "userId": "cmsx...", "seasonId": "2026-W34", "delta": 150,
  "totalScore": 10500, "rank": 2, "duplicate": false }
```

**`duplicate: true` bir hata değildir.** Aynı `idempotencyKey` ile tekrar gönderildiğinde `400` değil `201` + `duplicate: true` döner — idempotency'nin tanımı gereği aynı istek aynı sonucu vermelidir. Ağ kopması sonrası retry yapan istemciye "isteğin geçersiz" demek yanlış olurdu. Frontend bunu sessizce yutabilir veya "zaten kaydedilmişti" diye gösterebilir.

---

## 4. Ödül ve sezon durumu

### `GET /api/rewards/season?seasonId=` — geri sayım için tek uç

Kimlik gerektirmez. Frontend'in "haftalık ödül/durum iletişimi" için ihtiyacı olan her şey burada.

```jsonc
{
  "seasonId": "2026-W34",
  "isCurrentSeason": true,
  "startsAt": "2026-08-17T00:00:00.000Z",
  "endsAt": "2026-08-24T00:00:00.000Z",
  "secondsRemaining": 517436,
  "serverTime": "2026-08-18T00:16:03.885Z",
  "poolAmount": "94018764.62",
  "playerCount": 4950,
  "prizePoolRate": 0.02,
  "rewardedPlayerCount": 100,
  "distribution": { "first": 0.2, "second": 0.15, "third": 0.1, "remaining": 0.55 }
}
```

**Geri sayım nasıl yapılmalı:** `secondsRemaining`'i bir kez al, sonra istemci tarafında saymaya devam et. Her saniye istek atma. `serverTime` ile istemci saatinin farkını hesaplayıp saat kaymasını düzeltebilirsin — sezon sınırı herkes için aynı UTC anıdır, kullanıcının yerel saatine göre değişmez.

`distribution` oranları buradan gelir ki frontend bunları kendi içine sabitlemek zorunda kalmasın.

### `GET /api/rewards/pool?seasonId=`

Yalnızca havuz tutarı gerekiyorsa hafif alternatif.

```jsonc
{ "seasonId": "2026-W34", "poolAmount": "94018764.62" }
```

> **Para alanları daima string'dir.** `poolAmount`, `balance`, `amount` — hepsi. JSON `Number`'a çevirirsen kuruş hassasiyeti kaybolur. Görüntülemek için string'i olduğu gibi formatla, aritmetik yapman gerekiyorsa önce kuruşa (× 100) çevirip tamsayı ile çalış.

### `GET /api/rewards/projection` — "şu an bitse ne kazanırım?"

Kimlik **opsiyonel**. Token'sız istek yalnızca ilk 100'ün tahmini paylarını döndürür; token'lı istek ek olarak `me` alanında kendi payını da alır.

```jsonc
{
  "seasonId": "2026-W34",
  "poolAmount": "94018794.62",
  "rewardedPlayerCount": 100,
  "entries": [
    { "rank": 1, "userId": "cmsx...", "amount": "18803759.40" },
    { "rank": 2, "userId": "cmsx...", "amount": "14102819.19" },
    { "rank": 4, "userId": "cmsx...", "amount": "585956.83" }
  ],
  "me": {
    "rank": 121,
    "score": 3696088,
    "amount": "0.00",
    "isEligible": false,
    "pointsToEligible": 68836      // ilk 100'e girmek için gereken puan
  }
}
```

**Neden sunucuda hesaplanıyor:** 4-100 aralığındaki pay skora **orantılıdır** — bir oyuncunun payını bilmek ilk 100'ün *tüm* skorlarının toplamını gerektirir. İlk 100 dışındaki oyuncunun istemcisinde bu veri yoktur; sadece kendi payını öğrenmek için 100 satır çekmesi gerekirdi.

Daha önemlisi: tahmin, gerçek dağıtımla **aynı fonksiyonu** (`allocatePrizePool`) kullanır. Ayrı bir formül yazılsaydı ikisi zamanla ayrışır ve oyuncuya gösterilen tutar ödenenden farklı olurdu.

Doğrulandı: `entries` toplamı havuza **kuruşu kuruşuna eşittir**.

| Alan | Anlamı |
| --- | --- |
| `me.amount` | Sezon şu an bitse kazanacağı tutar (string) |
| `me.isEligible` | İlk 100'de mi — `false` ise `amount` `"0.00"` |
| `me.pointsToEligible` | Ödül almaya başlamak için gereken puan; zaten alıyorsa `null` |

`pointsToEligible` idle oyunda en güçlü motivasyon sinyalidir: *"68.836 puan daha kazan, ödül almaya başla."*

### `POST /api/rewards/distribute`

Dağıtımı elle tetikler. `seasonId` verilmezse bir önceki hafta.

```jsonc
{ "seasonId": "2026-W34", "poolAmount": "94018764.62", "rewardedCount": 100,
  "distributedAmount": "94018764.62", "skippedUnknownUsers": 0, "seasonReset": true }
```

**Asıl dağıtım yolu bu değildir.** Haftalık dağıtım cron ile **otomatik**
çalışır (Pazartesi 00:05 UTC). Bu uç yalnızca, sezonun bitmesini beklemeden
dağıtımın çalıştığını görebilmek için vardır ve bu yüzden kimlik doğrulaması
istemez.

Ucun yıkıcılığı idempotency ile sınırlanır: aynı sezon ikinci kez dağıtılamaz
(`409`) ve eşzamanlı çağrılar Redis kilidine takılır — art arda çağırmak çift
ödeme üretemez.

| Durum | Yanıt |
| --- | --- |
| Sezon zaten dağıtılmış | `409` |
| Dağıtım hâlihazırda sürüyor (başka instance) | `409` |

> ⚠️ **Dağıtım yıkıcıdır:** `seasonReset: true` döndüğünde o sezonun Redis sıralaması ve havuzu **silinir**. Demoda tetiklersen tabloyu yeniden doldurmak için `npm run seed -- --reset` gerekir. Frontend'de bu butona onay diyaloğu koy.

---

## 5. Oyuncunun kendi verileri

### `GET /api/me?seasonId=` 🔒 — açılış ekranı için birleşik durum

Sıra, skor, bakiye ve son ödül **tek istekte**. Mobil bağlantıda üç ayrı gidiş-dönüşten kaçınmak için birleştirildi.

```jsonc
{
  "userId": "cmsx...", "username": "demo_neon_pilot_5", "country": "TR",
  "seasonId": "2026-W34", "rank": 1, "score": 4526619,
  "balance": "0.0000",
  "lastReward": null    // veya { seasonId, rank, amount, status, distributedAt }
}
```

### `GET /api/me/wallet` 🔒

```jsonc
{ "userId": "cmsx...", "balance": "0.0000", "version": 0, "updatedAt": null }
```

Cüzdan yalnızca ilk ödülde yaratılır; yokluğu hata değil, sıfır bakiyedir.

### `GET /api/me/rewards` 🔒 — ödül geçmişi

```jsonc
{
  "userId": "cmsx...", "count": 2, "totalEarned": "1250.00",
  "rewards": [
    { "seasonId": "2026-W33", "rank": 3, "score": "89100",
      "amount": "1000.0000", "status": "DISTRIBUTED",
      "distributedAt": "2026-08-17T00:05:12.000Z" }
  ]
}
```

Boş liste ilk hafta için normaldir — henüz dağıtım yapılmamıştır.

---

## 6. Hata biçimi

Tüm hatalar Nest'in standart biçiminde döner:

```jsonc
{ "message": ["seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34"],
  "error": "Bad Request", "statusCode": 400 }
```

`message` doğrulama hatalarında **dizi**, diğerlerinde **string**'dir. Frontend'de `Array.isArray(message) ? message.join(', ') : message` ile normalize et.

| Kod | Anlamı | Frontend ne yapmalı |
| --- | --- | --- |
| `400` | Doğrulama hatası | Mesajı göster |
| `401` | Token yok/geçersiz/süresi dolmuş | `identify`'ı tekrar çağır |
| `403` | Yetki yok (admin gerekli) | "Bu işlem için admin token gerekli" |
| `404` | Oyuncu bulunamadı | Seçiciyi yenile |
| `409` | Sezon zaten dağıtılmış | Bilgilendir |

---

## 7. CORS

Kabul edilen origin'ler:

- `http://localhost:3000` — Next.js varsayılanı
- `http://localhost:5173` — Vite varsayılanı
- `http://127.0.0.1:3000` ve `http://127.0.0.1:5173`
- Tüm `*.vercel.app` alan adları

`credentials: true` açıktır. Başka bir port kullanacaksan `src/main.ts` içindeki origin listesine ekle.

---

## 8. Uç özeti — hangisi ne işe yarar?

Kimlik sütunu: ➖ herkese açık · 🔒 token gerekli · ➖/🔒 opsiyonel (token'lı istek daha fazlasını alır)

### Kimlik

| Uç | Kimlik | Ne işe yarar |
| --- | --- | --- |
| `POST /api/auth/identify` | ➖ | **Token alır.** Login yerine geçer: hangi oyuncu olarak bakılacağını seçer ve imzalı JWT döndürür. Uygulama açılışında bir kez çağrılır. `mode` ile senaryo seçilir (`top`/`mid`/`outside`/`unranked`) |
| `GET /api/auth/players` | ➖ | **Oyuncu listesi/arama.** "Oyuncu değiştir" ekranını besler; kullanıcı adına göre arar |

### Liderlik tablosu

| Uç | Kimlik | Ne işe yarar |
| --- | --- | --- |
| `GET /api/leaderboard` | ➖ | **Ana tablo.** İlk N oyuncu (`limit` en fazla 100). Ekranın gövdesi bu |
| `GET /api/leaderboard/around` | 🔒 | ⭐ **Case'in can alıcı özelliği.** İki şey birden verir: `entries` (oyuncu ilk 100 dışındaysa 3 üst + ben + 2 alt penceresi) ve `neighbours` (her koşulda kişiye özel çevre — 1. sıradaysan üstünde kimse çıkmaz) |
| `GET /api/leaderboard/rank` | 🔒 | **Sadece kendi sıran.** Tabloyu çekmeden tek satır; polling için ucuz |

### Skor

| Uç | Kimlik | Ne işe yarar |
| --- | --- | --- |
| `POST /api/score` | 🔒 | **Skor artırır.** `delta` fark değeridir, mutlak skor değil. Havuza otomatik %2 katkı buradan gider. `idempotencyKey` ile tekrar gönderim çift saymaz |

### Ödül ve sezon

| Uç | Kimlik | Ne işe yarar |
| --- | --- | --- |
| `GET /api/rewards/season` | ➖ | **Geri sayım + havuz + oranlar.** Üst bandın tek kaynağı: sezon ne zaman bitiyor, havuzda ne kadar var, dağıtım yüzdeleri ne |
| `GET /api/rewards/pool` | ➖ | **Sadece havuz tutarı.** `season`'ın hafif alternatifi; yalnızca rakam lazımsa |
| `GET /api/rewards/projection` | ➖/🔒 | **"Şu an bitse ne kazanırım?"** İlk 100'ün tahmini payları; token'lı istekte `me.amount` ile kendi payın ve `me.pointsToEligible` ile ödüle kaç puan kaldığın. Tahmin, gerçek dağıtımla aynı fonksiyonu kullanır — gösterilen tutar ödenenden ayrışamaz |
| `POST /api/rewards/distribute` | 🔒 admin | **Dağıtımı tetikler.** ⚠️ Yıkıcı: sezonun sıralamasını ve havuzunu siler. Demo'da onay diyaloğu koy |

### Oyuncunun kendi verileri

| Uç | Kimlik | Ne işe yarar |
| --- | --- | --- |
| `GET /api/me` | 🔒 | **Açılış ekranının tek isteği.** Sıra + skor + bakiye + son ödül bir arada; üç ayrı istek atmaya gerek kalmaz |
| `GET /api/me/wallet` | 🔒 | **Cüzdan bakiyesi.** Kazanılan toplam para |
| `GET /api/me/rewards` | 🔒 | **Ödül geçmişi.** Geçmiş sezonlarda ne kazandığı + `totalEarned` |

### Tipik ekran → uç eşlemesi

| Ekranda ne var | Hangi uç |
| --- | --- |
| Üstteki geri sayım ve havuz | `GET /api/rewards/season` |
| "Sen #121'sin" kartı | `POST /api/auth/identify` (açılış) veya `GET /api/me` |
| İlk 100 listesi | `GET /api/leaderboard?limit=100` |
| Her satırdaki tahmini ödül | `GET /api/rewards/projection` |
| "Senin çevren" mini listesi | `GET /api/leaderboard/around` → `neighbours` |
| "Ödüle 68.836 puan kaldı" | `GET /api/rewards/projection` → `me.pointsToEligible` |
| Cüzdan / geçmiş kazanç | `GET /api/me/wallet`, `GET /api/me/rewards` |
| Oyuncu değiştirici | `GET /api/auth/players` + `POST /api/auth/identify` |

### Açılışta kaç istek?

Üçü **paralel** atılır (sıralı atma, 3 kat yavaşlar):

```js
const [board, around, season] = await Promise.all([
  fetch(`${API}/leaderboard?limit=100`).then(r => r.json()),
  fetch(`${API}/leaderboard/around`, { headers: auth }).then(r => r.json()),
  fetch(`${API}/rewards/season`).then(r => r.json()),
]);
```

Ödül tahminleri gösterilecekse `projection` dördüncü olarak eklenir.

**Kırılmaz kurallar:**
1. Para daima **string** (`amount`, `balance`, `poolAmount`) — `Number`'a çevirip aritmetik yapma, kuruş kaybolur.
2. `rank: null` ≠ `rank: 0` — biri "sıralamada değil", diğeri imkânsız (0. sıra yok).
3. `duplicate: true` hata değil, başarılı bir tekrar — `400` beklemeyin, `201` döner.
4. `entries` ve `neighbours` uzunlukları **sabit değil** (tablo sınırlarında kısalır) — kendi satırını `isCurrentUser` ile bul.
5. `userId`/`seasonId` skor gövdesinde **gönderilmez** — gönderilirse `400`.
6. `country` **`null` olabilir** — bayrak gösterirken kontrol et.
