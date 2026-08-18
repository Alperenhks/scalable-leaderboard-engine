/**
 * Örnek veri üreticisi — jürinin sistemi gerçek koşullarda test edebilmesi için.
 *
 *   npm run seed              # 5.000 oyuncu (varsayılan, ~30 sn)
 *   npm run seed -- --players 50000
 *   npm run seed -- --reset   # önce mevcut örnek veriyi temizler
 *
 * Neden bu ölçek: case 2M DAU'dan bahsediyor ama jürinin projeyi klonlayıp
 * beklemesi gereken süre makul kalmalı. 5.000 oyuncu "3 üst / 2 alt"
 * penceresinin ilk 100 dışında çalıştığını göstermeye fazlasıyla yeter;
 * --players ile ölçek istendiği kadar büyütülebilir.
 *
 * Üretilen veri üç deponun HEPSİNE yazılır ki sistem uçtan uca tutarlı olsun:
 *   Postgres → oyuncu kimlikleri (ad, ülke)
 *   Redis    → canlı sıralama (ZSET) + ödül havuzu, gerçek skor akışıyla
 *   Mongo    → skor event log'ları (örneklem; her event yazılmaz, aşağıya bkz.)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import mongoose from 'mongoose';
import { PrismaClient } from '../generated/prisma/client';
import { getCurrentSeasonId } from '../src/common/season.util';
import { PRIZE_POOL_RATE } from '../src/rewards/reward-math';

/** Örnek oyuncuların kullanıcı adı öneki — temizlik bu önekle yapılır. */
const SEED_PREFIX = 'demo_';

/** Mongo'ya yazılacak event örneklem oranı (yüzde). */
const EVENT_SAMPLE_PERCENT = 2;

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const PLAYER_COUNT = flag('players', 5_000);
const SHOULD_RESET = args.includes('--reset');

/**
 * Deterministik rastgelelik (mulberry32).
 *
 * Math.random yerine sabit tohumlu üreteç: aynı komut her çalıştığında aynı
 * tabloyu üretir. Jüri gördüğü ekran görüntüsünü birebir yeniden üretebilir,
 * hata bildirimi tekrarlanabilir olur.
 */
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260818);
const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(rng() * list.length)];

const COUNTRIES = [
  'TR', 'US', 'DE', 'GB', 'FR', 'BR', 'JP', 'KR', 'IN', 'RU',
  'ES', 'IT', 'NL', 'PL', 'MX', 'CA', 'AU', 'SE', 'AR', 'ID',
] as const;

const ADJECTIVES = [
  'swift', 'iron', 'shadow', 'golden', 'crimson', 'silent', 'turbo', 'mega',
  'cosmic', 'lucky', 'wild', 'frost', 'blazing', 'neon', 'atomic', 'royal',
] as const;

const NOUNS = [
  'pilot', 'tycoon', 'baron', 'runner', 'hawk', 'tiger', 'nomad', 'captain',
  'wolf', 'phoenix', 'raven', 'falcon', 'panda', 'viper', 'comet', 'ranger',
] as const;

const SOURCES = [
  'idle_tick', 'quest_complete', 'purchase', 'daily_bonus',
  'achievement', 'ad_reward', 'level_up', 'combo_streak',
] as const;

/**
 * Gerçekçi skor dağılımı: az sayıda çok yüksek skorlu "whale", geniş bir orta
 * kitle, uzun bir kuyruk. Düz rastgele dağılım liderlik tablosunu yapay
 * gösterirdi — gerçek idle oyunlarda skor üstel olarak seyrelir.
 */
function generateScore(index: number, total: number): number {
  const position = index / total;
  const base = Math.pow(1 - position, 3.2) * 4_000_000;
  const noise = 0.85 + rng() * 0.3;
  return Math.max(50, Math.round(base * noise));
}

function generateUsername(index: number): string {
  return `${SEED_PREFIX}${pick(ADJECTIVES)}_${pick(NOUNS)}_${index}`;
}

async function main(): Promise<void> {
  console.log(
    `\n▶ Örnek veri üretiliyor: ${PLAYER_COUNT.toLocaleString('tr-TR')} oyuncu` +
      `${SHOULD_RESET ? ' (önce temizlik yapılacak)' : ''}\n`,
  );

  const seasonId = getCurrentSeasonId();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const redis = new Redis(process.env.REDIS_URL!);
  await mongoose.connect(process.env.MONGO_URI!, { dbName: 'leaderboard' });
  const events = mongoose.connection.db!.collection('score_events');

  try {
    if (SHOULD_RESET) {
      console.log('· Mevcut örnek veri temizleniyor…');
      // Wallet ve RewardLog onDelete: Cascade ile birlikte gider.
      const deleted = await prisma.user.deleteMany({
        where: { username: { startsWith: SEED_PREFIX } },
      });
      await redis.del(`lb:${seasonId}`, `pool:${seasonId}`);
      await events.deleteMany({ source: { $in: [...SOURCES] } });
      console.log(`  ${deleted.count} oyuncu silindi.\n`);
    }

    // ---- 1) Postgres: oyuncu kimlikleri --------------------------------
    console.log('· Postgres: oyuncular yazılıyor…');
    const usernames = Array.from({ length: PLAYER_COUNT }, (_, i) =>
      generateUsername(i + 1),
    );

    // createMany tek gidiş-dönüş; 5.000 satır için tekil insert 5.000 kez
    // ağ turu demek olurdu (Neon'da dakikalar).
    const CHUNK = 1_000;
    for (let i = 0; i < usernames.length; i += CHUNK) {
      await prisma.user.createMany({
        data: usernames.slice(i, i + CHUNK).map((username) => ({
          username,
          country: pick(COUNTRIES),
        })),
        skipDuplicates: true,
      });
      process.stdout.write(
        `\r  ${Math.min(i + CHUNK, usernames.length)}/${usernames.length}`,
      );
    }

    const allPlayers = await prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, username: true, country: true },
    });
    console.log(`\r  ${allPlayers.length} oyuncu hazır.          \n`);

    // Son %1 bilinçli olarak SIRALAMA DIŞI bırakılır: "henüz bu hafta hiç
    // oynamamış oyuncu" senaryosu (rank: null) ancak böyle test edilebilir.
    // Herkese skor verilseydi bu kod yolu jüriye hiç görünmezdi.
    const unrankedCount = Math.max(1, Math.floor(allPlayers.length / 100));
    const players = allPlayers.slice(0, allPlayers.length - unrankedCount);
    const unranked = allPlayers.slice(allPlayers.length - unrankedCount);

    // ---- 2) Redis: canlı sıralama + havuz ------------------------------
    console.log('· Redis: sıralama ve ödül havuzu yazılıyor…');
    const scored = players.map((p, i) => ({
      ...p,
      score: generateScore(i, players.length),
    }));

    // Havuz, skorların %2'si — üretim akışıyla (poolContributionMinor) birebir
    // aynı kural: kuruş cinsinden tamsayı, float birikimi yok.
    let poolMinor = 0;
    const zsetArgs: (string | number)[] = [];
    for (const p of scored) {
      zsetArgs.push(p.score, p.id);
      poolMinor += Math.round(p.score * PRIZE_POOL_RATE * 100);
    }

    const key = `lb:${seasonId}`;
    await redis.del(key, `pool:${seasonId}`);

    // Önceki çalıştırmadan kalan ülke tabloları temizlenir; kalırlarsa
    // yeni skorlarla karışır. SCAN kullanılır — KEYS tek iş parçacıklı
    // Redis'i bloklar.
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(
        cursor,
        'MATCH',
        `${key}:c:*`,
        'COUNT',
        200,
      );
      cursor = next;
      if (found.length > 0) await redis.del(...found);
    } while (cursor !== '0');

    // ZADD'i parçalara böl: tek komutta 5.000 üye Upstash istek sınırını zorlar.
    for (let i = 0; i < zsetArgs.length; i += 2 * CHUNK) {
      await redis.zadd(key, ...zsetArgs.slice(i, i + 2 * CHUNK));
    }

    // Ülke tabloları: her ülke için ayrı ZSET. Uygulama da skor yazarken
    // aynı anahtarı besler, dolayısıyla seed ile üretim aynı yapıyı kurar.
    const byCountry = new Map<string, (string | number)[]>();
    for (const p of scored) {
      if (!p.country) continue;
      const cc = p.country.toUpperCase();
      const list = byCountry.get(cc) ?? [];
      list.push(p.score, p.id);
      byCountry.set(cc, list);
    }
    for (const [cc, args] of byCountry) {
      for (let i = 0; i < args.length; i += 2 * CHUNK) {
        await redis.zadd(`${key}:c:${cc}`, ...args.slice(i, i + 2 * CHUNK));
      }
    }

    // Profil cache'i (ad + ülke) önden doldurulur. Uygulama bunu ilk okumada
    // kendisi kurar, ama seed'den doldurmak jürinin ilk isteğini de hızlı
    // yapar — ayrıca skor yazma yolu ülkeyi buradan okur.
    const profilePipeline = redis.pipeline();
    for (const p of allPlayers) {
      profilePipeline.set(
        `profile:${p.id}`,
        JSON.stringify({ username: p.username, country: p.country }),
        'EX',
        86_400,
      );
    }
    await profilePipeline.exec();

    await redis.set(`pool:${seasonId}`, poolMinor);
    console.log(
      `  ${scored.length} skor + havuz ${(poolMinor / 100).toFixed(2)} yazıldı.`,
    );
    console.log(
      `  ${byCountry.size} ülke tablosu + ${allPlayers.length} profil cache'lendi.\n`,
    );

    // ---- 3) Mongo: skor event örneklemi --------------------------------
    // Her oyuncu için event yazılmaz: 5.000 oyuncu × ~40 event = 200.000 belge
    // olurdu ve seed dakikalarca sürerdi. Denetim log'unun ÇALIŞTIĞINI
    // göstermek için temsili bir örneklem yeterlidir.
    console.log(`· Mongo: event log örneklemi (%${EVENT_SAMPLE_PERCENT})…`);
    const sampleSize = Math.max(
      20,
      Math.floor((scored.length * EVENT_SAMPLE_PERCENT) / 100),
    );
    const docs = scored.slice(0, sampleSize).flatMap((p) => {
      const eventCount = 3 + Math.floor(rng() * 5);
      let running = 0;
      return Array.from({ length: eventCount }, () => {
        const delta = Math.max(1, Math.round((p.score / eventCount) * (0.6 + rng() * 0.8)));
        running += delta;
        return {
          userId: p.id,
          delta,
          totalScore: running,
          seasonId,
          source: pick(SOURCES),
          createdAt: new Date(Date.now() - Math.floor(rng() * 6 * 86_400_000)),
        };
      });
    });
    if (docs.length > 0) await events.insertMany(docs, { ordered: false });
    console.log(`  ${docs.length} event yazıldı.\n`);

    // ---- Özet -----------------------------------------------------------
    const top = await redis.zrevrange(key, 0, 2, 'WITHSCORES');
    const nameById = new Map(players.map((p) => [p.id, p.username]));
    console.log('✔ Tamamlandı.\n');
    console.log(`  Sezon        : ${seasonId}`);
    console.log(`  Sıralamada   : ${scored.length.toLocaleString('tr-TR')}`);
    console.log(
      `  Sırasız      : ${unranked.length.toLocaleString('tr-TR')} (rank: null senaryosu)`,
    );
    console.log(`  Ödül havuzu  : ${(poolMinor / 100).toFixed(2)}`);
    console.log('  İlk 3        :');
    for (let i = 0; i < top.length; i += 2) {
      console.log(
        `    ${i / 2 + 1}. ${nameById.get(top[i]) ?? top[i]} — ${Number(top[i + 1]).toLocaleString('tr-TR')}`,
      );
    }
    console.log(
      `\n  Frontend artık GET /api/auth/players ile bu oyuncuları listeleyebilir.\n`,
    );
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ Seed başarısız:', error);
  process.exit(1);
});
