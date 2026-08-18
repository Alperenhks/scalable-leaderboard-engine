# UI Rehberi — Liderlik Tablosu Ekranı

Panteon'un idle/clicker oyunu (*Airport Master* tarzı) için liderlik tablosu ekranının tasarım ve uygulama rehberi. API sözleşmesi için: **[API.md](API.md)**

**Canlı API:** `https://scalable-leaderboard-engine.onrender.com/api`

---

## 1. Oyunun bağlamı — ne tasarlıyoruz?

Bu bir **idle/clicker havalimanı yönetim oyunu**. Oyuncu uçak indirir, terminal büyütür, para kazanır. Oyun kapalıyken bile kazanmaya devam eder.

Bu bağlam UI'ı doğrudan belirler:

| Oyunun gerçeği | UI'a yansıması |
| --- | --- |
| Oyuncu haftada onlarca kez bakar | Ekran **hızlı taranabilir** olmalı, okumak zorunda bırakmamalı |
| Skorlar milyonlarca | Ham sayı değil, **kısaltılmış** gösterim (`4.5M`) |
| Çoğu oyuncu ilk 100'de değil | "Sen 121.sin" ekranın **merkezinde** olmalı, dipnot değil |
| Haftalık döngü var | **Geri sayım** sürekli görünür olmalı — aciliyet hissi oyunun motoru |
| Para kazanılıyor | Ödül havuzu **büyük ve canlı** gösterilmeli |

Case'in şikâyetleri de bunu doğruluyor:

> *"I can see the top players fine, but I can't find my own rank."*
> *"My friend is in the top 50 but the page just freezes when I scroll down."*

Yani **çözülmesi gereken iki şey:** kendi sıranı bulmak kolay olacak, liste asla donmayacak.

---

## 2. Ekran hiyerarşisi

Yukarıdan aşağı, önem sırasına göre:

```
┌─────────────────────────────────────────────┐
│  ⏱  SEZON GERİ SAYIMI      💰 ÖDÜL HAVUZU   │  ← Sabit üst bant
│     2g 14s 22dk               ₺94.018.764   │
├─────────────────────────────────────────────┤
│                                             │
│   👤 SEN                                    │  ← Yapışkan kart
│   #121  demo_turbo_falcon   3.696.088       │     (her zaman görünür)
│   ↑ Bir üstekine 264 puan kaldı             │
│                                             │
├─────────────────────────────────────────────┤
│  [ İlk 100 ]  [ Çevrem ]  [ Ülkem ]         │  ← Sekmeler
├─────────────────────────────────────────────┤
│  🥇  1  demo_neon_pilot     🇹🇷  4.5M  ₺18.8M│
│  🥈  2  demo_cosmic_baron   🇺🇸  4.4M  ₺14.1M│  ← Liste
│  🥉  3  demo_neon_baron     🇩🇪  4.4M   ₺9.4M│
│      4  demo_swift_hawk     🇧🇷  4.3M   ₺521K│
│      …                                       │
└─────────────────────────────────────────────┘
```

### Neden bu sıra?

1. **Geri sayım en üstte** — oyuncunun "acele etmeliyim" hissini kuran şey bu. Idle oyunlarda haftalık döngü tüm motivasyonu taşır.
2. **Kendi kartı ikinci** — case'in birinci şikâyeti "kendi sıramı bulamıyorum". Kaydırma gerektirmeden görünmeli.
3. **Liste en altta** — en çok yer kaplar ama en az acildir.

---

## 3. Kritik özellik: "Sen neredesin?"

Bu ekranın **var oluş sebebi**. İki durum var ve ikisi görsel olarak farklı olmalı.

### Durum A — Oyuncu ilk 100'de (`inTopWindow: true`)

Oyuncu zaten listede. Ayrı bir bölüm göstermeye gerek yok, sadece **satırını vurgula**.

```
   99  demo_wild_tiger      🇫🇷  3.7M
  100  demo_frost_wolf      🇮🇹  3.7M
▶  47  demo_SEN             🇹🇷  4.1M   ← parlak arka plan, kalın
  101  demo_atomic_comet    🇪🇸  3.6M
```

Yapışkan kartta da "🎉 İlk 100'desin!" gibi bir kutlama mesajı göster.

### Durum B — Oyuncu ilk 100 dışında (`inTopWindow: false`) ⭐

**Asıl senaryo bu.** API `[sıra-3 … sıra+2]` = tam 6 kayıt döndürür.

```
        …  (ilk 100 listesi yukarıda)
   ┄┄┄┄┄┄┄┄┄┄  ⋯ 18 sıra ⋯  ┄┄┄┄┄┄┄┄┄┄     ← görsel kopukluk
  118  demo_royal_falcon    🇩🇪  3.702.117
  119  demo_shadow_phoenix  🇧🇷  3.701.803
  120  demo_neon_ranger     🇺🇸  3.696.352   ↑ 264 puan
▶ 121  demo_turbo_falcon    🇷🇺  3.696.088   ← SEN
  122  demo_lucky_pilot     🇯🇵  3.695.344   ↓ 744 puan
  123  demo_blazing_hawk    🇹🇷  3.694.181
```

**Tasarım notları:**
- İlk 100 ile pencere arasına **görsel bir kopukluk** koy (kesikli çizgi, "⋯ 18 sıra ⋯" etiketi). Kullanıcı sıraların atlandığını anlamalı.
- **Farkı göster:** "bir üsttekine 264 puan" — bu, oyuncuyu tekrar oynamaya iten en güçlü sinyal. Idle oyunlarda hedefin yakın görünmesi kritik.
- Kendi satırın belirgin olsun ama **abartma** — parlak bir kenarlık ve hafif arka plan yeter.

### Durum C — Oyuncu hiç oynamamış (`rank: null`)

API `rank: null` döndürür ve `entries` tablonun başını taşır. **Bu `0` değildir** — sıfırıncı sıra diye bir şey yok.

```
┌───────────────────────────────────────┐
│  Bu hafta henüz sıralamada değilsin   │
│  İlk uçağını indir, tabloya gir! ✈️    │
│           [ Skor Gönder ]              │
└───────────────────────────────────────┘
```

Boş bir tablo yerine **eyleme çağıran** bir ekran göster.

---

## 4. Sekmeler — "global comparison" gereksinimi

Case *"opportunities for global comparison"* istiyor. Üç sekme öneriyorum:

| Sekme | Ne gösterir | Hangi uç |
| --- | --- | --- |
| **İlk 100** | Genel zirve | `GET /api/leaderboard?limit=100` |
| **Çevrem** | 3 üst + sen + 2 alt | `GET /api/leaderboard/around` |
| **Ülkem** | Aynı ülkeden oyuncular | İlk 100'ü `country` ile filtrele (istemcide) |

> **Not:** "Ülkem" sekmesi için ayrı bir uç yok. `entries[].country` alanı geldiği için ilk 100 içinde istemci tarafında filtreleyebilirsin. Gerçek bir ülke sıralaması (tüm 2M oyuncu içinde) ayrı bir Redis ZSET gerektirirdi — case bunu istemiyor, ama isterseniz backend'e eklenebilir.

Mobilde sekmeler **alt bar** olarak daha iyi çalışır (başparmak erişimi).

---

## 5. Ödül ve durum iletişimi

Case: *"the weekly reward/status communication"*

### Üst bant — her zaman görünür

```jsx
// GET /api/rewards/season
{
  "secondsRemaining": 516721,
  "serverTime": "2026-08-18T00:27:58.425Z",
  "poolAmount": "94018764.62",
  "playerCount": 4950,
  "distribution": { "first": 0.2, "second": 0.15, "third": 0.1, "remaining": 0.55 }
}
```

**Geri sayım:** `secondsRemaining`'i **bir kez** al, sonra istemcide say. Her saniye istek atma.

```js
const [remaining, setRemaining] = useState(data.secondsRemaining);
useEffect(() => {
  const t = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
  return () => clearInterval(t);
}, []);
```

Son 24 saatte rengi değiştir (turuncu → kırmızı) — aciliyet hissi.

### Ödül tahmini — güçlü bir dokunuş

`distribution` oranları API'den geliyor. Her satırda o oyuncunun **kazanacağı tahmini ödülü** gösterebilirsin:

```
🥇  1  demo_neon_pilot   4.5M   ₺18.803.752   ← havuz × 0.20
🥈  2  demo_cosmic_baron 4.4M   ₺14.102.814   ← havuz × 0.15
🥉  3  demo_neon_baron   4.4M    ₺9.401.876   ← havuz × 0.10
    4  demo_swift_hawk   4.3M      ₺521.043   ← kalan %55'ten payı
```

4-100 arası pay **skora orantılıdır** (sıraya değil):

```js
// 4-100 arasındaki bir oyuncunun tahmini payı
const tailScores = entries.slice(3, 100).reduce((s, e) => s + e.score, 0);
const share = (poolMinor * 0.55 * entry.score) / tailScores;
```

Bu, oyuncuya *"biraz daha oynarsam payım artar"* dedirtir — tam da idle oyunun istediği şey.

### Ödül geçmişi

```jsx
// GET /api/me/rewards
{ "count": 2, "totalEarned": "1250.00", "rewards": [...] }
```

Geçen haftanın sonucunu bir bildirim/modal olarak göster: *"Geçen hafta 3. oldun, ₺1.000 kazandın! 🎉"*

---

## 6. Oyuncu değiştirici — jüri için kritik

Login yok. Jürinin her senaryoyu görebilmesi için bir **oyuncu seçici** koy (ayarlar ikonu veya köşede küçük bir buton):

```jsx
const modes = [
  { id: 'top',      label: '👑 1. sıradaki oyuncu' },
  { id: 'mid',      label: '📊 Ortalama oyuncu' },
  { id: 'outside',  label: '🎯 İlk 100 dışı (121.)' },   // ⭐ asıl senaryo
  { id: 'unranked', label: '🆕 Hiç oynamamış' },
];

async function switchPlayer(mode) {
  const res = await fetch(`${API}/auth/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const { token } = await res.json();
  localStorage.setItem('token', token);
  refetchAll();
}
```

Kullanıcı token'ı hiç görmez — arka planda değişir. Jüri tek tıkla dört farklı ekranı test eder.

---

## 7. Uygulama detayları

### Açılış akışı

```js
// 1. Token var mı? Yoksa al.
let token = localStorage.getItem('token');
if (!token) {
  const res = await fetch(`${API}/auth/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),          // rastgele oyuncu
  });
  token = (await res.json()).token;
  localStorage.setItem('token', token);
}

// 2. Üç isteği PARALEL at — sıralı atma, 3 kat yavaşlar.
const [board, around, season] = await Promise.all([
  fetch(`${API}/leaderboard?limit=100`).then(r => r.json()),
  fetch(`${API}/leaderboard/around`, { headers: auth }).then(r => r.json()),
  fetch(`${API}/rewards/season`).then(r => r.json()),
]);
```

### Sayı formatlama

```js
// Skorlar: 4526619 → "4.5M"
const fmtScore = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
  : String(n);

// Para: DAİMA string gelir, Number'a çevirme!
const fmtMoney = (s) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })
    .format(Number(s));   // sadece GÖSTERİM için, aritmetik için değil
```

> ⚠️ Para alanları (`poolAmount`, `balance`, `amount`) **string**'dir. Aritmetik yapman gerekirse önce kuruşa çevir (`× 100`) ve tamsayı ile çalış. Doğrudan `Number` ile toplarsan kuruş kaybolur.

### Bayrak

```js
// "TR" → 🇹🇷  (ISO kodu emoji'ye çevirir, resim dosyası gerekmez)
const flag = (cc) => cc
  ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
  : '🏳️';
```

`country` **`null` olabilir** — her zaman kontrol et.

### Yeniden çekme (polling)

Liderlik tablosu canlı hissettirmeli ama sunucuyu yormamalı:

| Veri | Sıklık | Neden |
| --- | --- | --- |
| `/leaderboard` | 30 sn | Zirve yavaş değişir |
| `/leaderboard/around` | 15 sn | Kendi sıran daha kritik |
| `/rewards/season` | 60 sn | Havuz yavaş büyür; geri sayım istemcide |

Sekme arka plandayken polling'i **durdur** (`document.visibilityState`).

---

## 8. Performans — "sayfa donuyor" şikâyeti

Case'in üçüncü şikâyeti: *"the page just freezes when I scroll down."*

Backend bunu zaten çözüyor (`limit` üst sınırı 100). Frontend'de dikkat edilecekler:

- **100 satır sanallaştırma gerektirmez.** `react-window` gibi kütüphaneler bu boyutta gereksiz karmaşıklık. Düz `map` yeterli.
- **Sonsuz kaydırma yapma.** `offset` ile sayfalama var ama liderlik tablosunda "daha fazla yükle" anlamsız — kimse 500. sırayı merak etmiyor. İlk 100 + kendi çevren yeterli.
- **`key` prop'u `userId` olsun**, index değil. Sıra değiştiğinde React tüm listeyi yeniden çizmesin.
- **Skor değişimlerini animasyonla göster** ama abartma: sayı sayacı (count-up) veya kısa bir vurgu yeterli. Idle oyunda liste sürekli güncellenir, her seferinde zıplayan bir liste rahatsız eder.

---

## 9. Bileşen yapısı — "reusable React components" kriteri

Case bunu ayrıca puanlıyor. Önerilen ayrım:

```
components/
├── leaderboard/
│   ├── LeaderboardRow.tsx      // tek satır — rank, avatar, ad, bayrak, skor, ödül
│   ├── LeaderboardList.tsx     // satırları saran liste + boş durum
│   ├── AroundWindow.tsx        // 3 üst / 2 alt penceresi + kopukluk göstergesi
│   └── RankBadge.tsx           // 🥇🥈🥉 veya sayı rozeti
├── season/
│   ├── CountdownTimer.tsx      // geri sayım (kendi interval'i)
│   └── PrizePoolCard.tsx       // havuz tutarı + dağıtım oranları
├── player/
│   ├── MyRankCard.tsx          // yapışkan "sen" kartı
│   ├── PlayerSwitcher.tsx      // jüri için mod seçici
│   └── RewardHistory.tsx       // geçmiş kazanımlar
└── ui/
    ├── ScoreValue.tsx          // 4.5M formatlama
    ├── MoneyValue.tsx          // ₺ formatlama (string-safe)
    └── CountryFlag.tsx         // ISO → emoji
```

**Kilit nokta:** `LeaderboardRow` hem ilk 100 listesinde hem around penceresinde **aynı bileşen** olmalı. Tek fark bir `isCurrentUser` prop'u. İki ayrı satır bileşeni yazmak, kriterin tam tersi.

```jsx
<LeaderboardRow
  entry={entry}
  isCurrentUser={entry.isCurrentUser}
  estimatedPrize={calcPrize(entry, pool)}
/>
```

---

## 10. Mobil

Case: *"tested on both PC and mobile"*

- **Alt sekme barı** — başparmak erişimi, üst sekmeler mobilde zor.
- **Yapışkan "sen" kartı** — kaydırırken üstte kalsın (`position: sticky`).
- **Satır yüksekliği ≥ 56px** — dokunma hedefi.
- **Yatay taşma yok** — uzun kullanıcı adlarını `text-overflow: ellipsis` ile kes.
- **Ödül sütunu mobilde gizlenebilir** — dar ekranda rank + ad + skor yeter, ödül detayı satıra dokununca açılsın.

---

## 11. Kontrol listesi

Teslim öncesi:

- [ ] Oyuncu ilk 100 dışındayken **tam 6 kayıt** görünüyor ve kendi satırı vurgulu
- [ ] `rank: null` durumunda boş tablo değil, eyleme çağıran ekran var
- [ ] Geri sayım çalışıyor ve saniyede bir istek atmıyor
- [ ] Para alanları string olarak işleniyor (kuruş kaybı yok)
- [ ] `country: null` çökmüyor
- [ ] Oyuncu değiştirici ile 4 mod da denenebiliyor
- [ ] Mobilde yatay kaydırma yok
- [ ] `LeaderboardRow` her iki listede de aynı bileşen
- [ ] Sekme arka plandayken polling duruyor
- [ ] İlk yüklemede Render uyanma gecikmesi için yükleniyor ekranı var

> **Render uyarısı:** Ücretsiz katmanda 15 dk hareketsizlikten sonra servis uyuyor, ilk istek ~50 sn sürebilir. Açılışta bir iskelet (skeleton) ekranı göster, boş sayfa bırakma.
