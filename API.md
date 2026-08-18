# API Sözleşmesi — Frontend Rehberi

Bu doküman frontend'in ihtiyaç duyduğu her şeyi içerir: uçlar, tipler, akışlar ve tasarım notları. Backend tarafında bu sözleşmenin dışında bir şey yoktur.

**Base URL (canlı):** `https://scalable-leaderboard-engine.onrender.com/api`
**Yerel:** `http://localhost:8080/api`

> **UI tasarımı ve ekran akışları için:** [UI_GUIDE.md](UI_GUIDE.md)

---

## 1. Kimlik: login yok, "oyuncu seç" var

Case bir login akışı istemiyor, ama *"players should clearly see **their own** ranking"* diyor. Bu ikisi çelişmez: sunucunun **kim olduğunu bilmesi** yeter, **kanıtlamasını istemek** gerekmez.

Çözüm: **oyuncu kimliğine bürünme.** Frontend "hangi oyuncu olarak bakıyorum?" der, backend o oyuncu için gerçek bir JWT üretir. Şifre yok, kayıt yok, e-posta yok.

> **Önemli:** Token gerçek bir JWT'dir ve tüm korumalı uçlar onu normal guard'dan geçirir. Yani **auth mimarisi üretim kalitesindedir**; yalnızca "kimliği kanıtlama" adımı demo gereği atlanmıştır. Gerçek bir oyunda bu ucun yerine oyunun kendi login'i gelir, arkasındaki hiçbir şey değişmez.

### `POST /api/auth/identify`

Gövde **tamamen opsiyoneldir** — boş `{}` gönderirsen rastgele bir oyuncu döner. Frontend hiçbir ön bilgi olmadan çalışmaya başlayabilir.

```jsonc
// İstek — üç kullanım biçimi
{}                                    // rastgele oyuncu
{ "username": "demo_neon_pilot_5" }   // belirli oyuncu
{ "mode": "outside" }                 // senaryoya göre oyuncu
{ "mode": "top", "role": "admin" }    // admin yetkili token
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

**Frontend notları:**
- `isCurrentUser: true` olan satırı görsel olarak vurgula — bu özelliğin bütün amacı bu.
- `inTopWindow: true` ise ayrı bir "senin sıran" bölümü göstermeye gerek yok, oyuncu zaten listede.
- `rank: null` ise oyuncu bu hafta hiç oynamamış: pencere yerine tablonun başı döner. "Skor gönder, sıralamaya gir" mesajı için doğru an.
- Oyuncu tablonun son 2 sırasındaysa 6 yerine 5 veya 4 kayıt gelebilir (aşağıda kimse yok) — liste uzunluğunu sabit varsayma.

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

### `POST /api/rewards/distribute` 🔒 **admin**

Dağıtımı elle tetikler. `seasonId` verilmezse bir önceki hafta.

```jsonc
{ "seasonId": "2026-W34", "poolAmount": "94018764.62", "rewardedCount": 100,
  "distributedAmount": "94018764.62", "skippedUnknownUsers": 0, "seasonReset": true }
```

Admin token için: `POST /api/auth/identify { "mode": "top", "role": "admin" }`

| Durum | Yanıt |
| --- | --- |
| Token yok | `401` |
| `player` token | `403` |
| Sezon zaten dağıtılmış | `409` |

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

`http://localhost:3000` ve tüm `*.vercel.app` alan adları kabul edilir; `credentials: true` açıktır. Farklı bir port kullanacaksan `src/main.ts` içindeki origin listesine ekle.

---

## 8. Sözleşme özeti

| Uç | Kimlik | Not |
| --- | --- | --- |
| `POST /api/auth/identify` | ➖ | Token al |
| `GET /api/auth/players` | ➖ | Oyuncu seçici |
| `GET /api/leaderboard` | ➖ | İlk N |
| `GET /api/leaderboard/around` | 🔒 | ⭐ 3 üst + ben + 2 alt |
| `GET /api/leaderboard/rank` | 🔒 | Yalnızca sıra |
| `POST /api/score` | 🔒 | Skor artışı |
| `GET /api/rewards/season` | ➖ | Geri sayım + oranlar |
| `GET /api/rewards/pool` | ➖ | Havuz |
| `GET /api/rewards/projection` | ➖/🔒 | Tahmini ödüller + kendi payın |
| `POST /api/rewards/distribute` | 🔒 admin | Yıkıcı |
| `GET /api/me` | 🔒 | Birleşik durum |
| `GET /api/me/wallet` | 🔒 | Bakiye |
| `GET /api/me/rewards` | 🔒 | Ödül geçmişi |

**Kırılmaz kurallar:**
1. Para daima **string** — `Number`'a çevirme.
2. `rank: null` ≠ `rank: 0` — biri "sıralamada değil", diğeri imkânsız.
3. `duplicate: true` hata değil, başarılı bir tekrar.
4. `around` liste uzunluğu sabit değil (tablo sonunda kısalır).
5. `userId`/`seasonId` skor gövdesinde gönderilmez.
