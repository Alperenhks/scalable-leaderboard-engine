/**
 * Ölçek testi — sıralama gerçekten oyuncu sayısından bağımsız mı?
 *
 *   node perf/scale-test.mjs            # 2.000.000 üyeye kadar
 *   node perf/scale-test.mjs 500000     # daha küçük ölçek
 *
 * Case 10M kayıtlı / 2M günlük aktif oyuncudan bahsediyor. Bu mimarinin
 * temel iddiası, sıralama maliyetinin oyuncu sayısıyla DEĞİL sayfa boyutuyla
 * orantılı olduğudur (`ZREVRANK` O(log N), `ZREVRANGE` O(log N + M)).
 *
 * Bu script o iddiayı ölçer: ZSET'i kademeli büyütüp her adımda aynı üç
 * sorguyu çalıştırır. Süreler sabit kalıyorsa iddia doğrulanmış olur.
 *
 * Ölçüm CANLI Redis'e (Upstash) karşı yapılır, bu yüzden her sayının içinde
 * ~48 ms ağ turu vardır. Aranan şey mutlak süre değil, ölçek büyürken sürenin
 * DEĞİŞMEMESİDİR.
 *
 * Test kendi anahtarını kullanır (`sc:test`) ve sonunda siler; canlı
 * sıralamaya (`lb:*`) dokunmaz.
 */
import 'dotenv/config';
import Redis from 'ioredis';

const KEY = 'sc:test';
const TARGET = Number(process.argv[2] ?? 2_000_000);

/**
 * Yazma partisi. 100k argümanlı bir `zadd` çağrı yığınını taşırır
 * (`RangeError: Maximum call stack size exceeded`), 10k güvenli sınırdır.
 */
const BATCH = 10_000;

/** Üye adı base36 ile kısaltılır — Upstash'in 100 MB anahtar sınırı için. */
const member = (n) => n.toString(36);

const measure = async (fn) => {
  const started = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
await redis.del(KEY);

console.log(`Ölçek testi — hedef: ${TARGET.toLocaleString('tr-TR')} üye\n`);
console.log('     üye sayısı │ ZREVRANK │ ilk 100 │ 3 üst + 2 alt │ derin sayfa');
console.log('───────────────┼──────────┼─────────┼───────────────┼────────────');

const CHECKPOINTS = [1_000, 10_000, 100_000, 500_000, 1_000_000, 2_000_000].filter(
  (c) => c <= TARGET,
);

let written = 0;
let planLimitHit = false;

for (const checkpoint of CHECKPOINTS) {
  try {
    while (written < checkpoint) {
      const n = Math.min(BATCH, checkpoint - written);
      const args = [];
      for (let i = 0; i < n; i++) {
        // Skor azalan: ilk yazılan en yüksek skorlu olur.
        args.push(TARGET - (written + i), member(written + i));
      }
      await redis.zadd(KEY, ...args);
      written += n;
    }
  } catch (error) {
    // Upstash ücretsiz planında anahtar başına 100 MB sınırı var ve bu
    // ~1,3M üyede dolar. Bir KOD sınırı değil, barındırma planı sınırıdır:
    // aynı ZSET kendi Redis'inde 2M+ üyeyi taşır. Ölçüm buraya kadar
    // toplanan veriyle anlamlıdır, o yüzden çökmek yerine raporlanır.
    if (String(error?.message ?? '').includes('max single record size')) {
      planLimitHit = true;
      break;
    }
    throw error;
  }

  const total = await redis.zcard(KEY);
  // En kötü durum seçilir: tablonun tam ortasındaki oyuncu.
  const middle = member(Math.floor(total / 2));

  const rank = await measure(() => redis.zrevrank(KEY, middle));
  const top = await measure(() => redis.zrevrange(KEY, 0, 99, 'WITHSCORES'));
  const around = await measure(async () => {
    const index = await redis.zrevrank(KEY, middle);
    return redis.zrevrange(KEY, Math.max(0, index - 3), index + 2, 'WITHSCORES');
  });
  // Derin sayfalama: klasik OFFSET yaklaşımının çöktüğü yer.
  const deepOffset = Math.max(0, total - 200);
  const deep = await measure(() =>
    redis.zrevrange(KEY, deepOffset, deepOffset + 99, 'WITHSCORES'),
  );

  console.log(
    `${total.toLocaleString('tr-TR').padStart(14)} │ ${rank.toFixed(1).padStart(7)}ms │ ${top.toFixed(1).padStart(6)}ms │ ${around.toFixed(1).padStart(12)}ms │ ${deep.toFixed(1).padStart(9)}ms`,
  );
}

await redis.del(KEY);
await redis.quit();

if (planLimitHit) {
  console.log(
    `\nNot: ${written.toLocaleString('tr-TR')} üyede Upstash'in ücretsiz plan sınırına` +
      '\n(anahtar başına 100 MB) ulaşıldı. Bu bir kod sınırı değil, barındırma' +
      '\nplanı sınırıdır; aynı yapı kendi Redis kurulumunda 2M+ üyeyi taşır.',
  );
}

console.log(
  '\nSüreler ölçekten bağımsız kalıyorsa sıralama maliyeti oyuncu sayısıyla\nartmıyor demektir; ölçülen sürenin neredeyse tamamı ağ turudur.',
);
