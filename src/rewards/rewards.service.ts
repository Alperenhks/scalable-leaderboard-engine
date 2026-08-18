import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { CacheService } from '../redis/cache.service';
import { PlayersService } from '../players/players.service';
import {
  allocatePrizePool,
  minorUnitsToDecimalString,
  REWARDED_PLAYER_COUNT,
  RewardAllocation,
} from './reward-math';

export interface DistributionResult {
  seasonId: string;
  poolAmount: string;
  rewardedCount: number;
  distributedAmount: string;
  skippedUnknownUsers: number;
  seasonReset: boolean;
}

/** Dağıtımın tek instance'ta çalışmasını sağlayan kilit. */
const LOCK_TTL_SECONDS = 300;

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly cache: CacheService,
  ) {}

  private lockKey(seasonId: string): string {
    return `lock:distribute:${seasonId}`;
  }

  /**
   * Sezon ödüllerini dağıtır.
   *
   * Idempotency üç katmanlıdır:
   *   1. Redis SET NX kilidi — aynı anda iki instance giremez.
   *   2. RewardLog'daki (userId, seasonId) tekil kısıtı — veritabanı seviyesinde
   *      aynı oyuncuya iki kez ödeme yapılmasını engeller.
   *   3. Ön-kontrol — sezon zaten dağıtılmışsa hiç başlamaz.
   *
   * Kilit tek başına yeterli değildir: TTL dolması ya da Redis'in yeniden
   * başlaması kilidi düşürebilir. Asıl güvence veritabanı kısıtıdır.
   */
  async distributeSeason(seasonId: string): Promise<DistributionResult> {
    const lock = await this.redis.set(
      this.lockKey(seasonId),
      '1',
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );

    if (lock === null) {
      throw new ConflictException(
        `${seasonId} sezonu için dağıtım hâlihazırda sürüyor`,
      );
    }

    try {
      return await this.runDistribution(seasonId);
    } finally {
      await this.redis.del(this.lockKey(seasonId));
    }
  }

  private async runDistribution(seasonId: string): Promise<DistributionResult> {
    const alreadyDone = await this.prisma.rewardLog.count({
      where: { seasonId },
    });

    if (alreadyDone > 0) {
      throw new ConflictException(
        `${seasonId} sezonu zaten dağıtılmış (${alreadyDone} kayıt)`,
      );
    }

    const poolMinor = await this.leaderboard.getPrizePoolMinor(seasonId);
    const candidates = await this.leaderboard.getRewardCandidates(
      seasonId,
      REWARDED_PLAYER_COUNT,
    );

    const allocations = allocatePrizePool(poolMinor, candidates);

    if (allocations.length === 0) {
      this.logger.warn(
        `${seasonId}: dağıtılacak ödül yok (havuz=${poolMinor}, aday=${candidates.length})`,
      );
      return {
        seasonId,
        poolAmount: minorUnitsToDecimalString(poolMinor),
        rewardedCount: 0,
        distributedAmount: '0.00',
        skippedUnknownUsers: 0,
        seasonReset: false,
      };
    }

    // ZSET'te olup Postgres'te olmayan kullanıcılar elenir: RewardLog.userId
    // bir foreign key'dir, var olmayan kullanıcıya yazmak transaction'ı komple
    // düşürür ve tüm dağıtımı engellerdi.
    const known = await this.prisma.user.findMany({
      where: { id: { in: allocations.map((a) => a.userId) } },
      select: { id: true },
    });
    const knownIds = new Set(known.map((u) => u.id));
    const payable = allocations.filter((a) => knownIds.has(a.userId));
    const skipped = allocations.length - payable.length;

    if (skipped > 0) {
      this.logger.warn(
        `${seasonId}: ${skipped} ödül alıcısı Postgres'te bulunamadı, atlandı`,
      );
    }

    const distributedMinor = await this.persist(seasonId, payable);

    // Cüzdan özeti cache'i geçersiz kılınır: bakiye ve son ödül YALNIZCA
    // burada değişir, dolayısıyla geçersiz kılmanın tek doğru yeri burasıdır.
    // Postgres'e yazıldıktan SONRA silinir — önce silinseydi, yazma
    // tamamlanana kadar gelen bir istek eski değeri yeniden cache'lerdi.
    await this.cache.delete(
      payable.map((a) => PlayersService.accountKey(a.userId)),
    );

    // Redis ancak Postgres'e yazıldıktan SONRA sıfırlanır. Ters sırada
    // dağıtım yarıda kalırsa sıralama ve havuz geri getirilemezdi.
    await this.leaderboard.resetSeason(seasonId);

    this.logger.log(
      `${seasonId}: ${payable.length} oyuncuya ${minorUnitsToDecimalString(distributedMinor)} dağıtıldı`,
    );

    return {
      seasonId,
      poolAmount: minorUnitsToDecimalString(poolMinor),
      rewardedCount: payable.length,
      distributedAmount: minorUnitsToDecimalString(distributedMinor),
      skippedUnknownUsers: skipped,
      seasonReset: true,
    };
  }

  /**
   * Ödül kaydı ve cüzdan bakiyesi TEK transaction'da yazılır.
   *
   * Ayrı yazılsalardı araya düşen bir hata, ödül kaydı olan ama parası
   * ödenmemiş (veya tersi) oyuncular bırakırdı.
   *
   * Bakiye `increment` ile güncellenir: Postgres bunu satır kilidi altında
   * atomik uygular, yani eşzamanlı iki ödül yazımı birbirini ezmez. Okuyup
   * hesaplayıp geri yazsaydık lost update riski doğardı. `Wallet.version`
   * yalnızca yazım sayacıdır, kilit mekanizması değildir.
   *
   * Sorgu sayısı bilinçli olarak düşük tutulur. Oyuncu başına ayrı create +
   * upsert yazmak 100 oyuncuda 200 ardışık gidiş-dönüş demektir; Neon gibi
   * uzak bir veritabanında bu, transaction zaman aşımına takılır (ölçüldü:
   * ~5.2s). Bunun yerine ödül kayıtları tek createMany ile, cüzdanlar ise
   * mevcut/yeni ayrımına göre gruplanmış sorgularla yazılır.
   */
  private async persist(
    seasonId: string,
    allocations: RewardAllocation[],
  ): Promise<bigint> {
    const distributed = allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
    const distributedAt = new Date();

    // Hangi oyuncunun cüzdanı var? Transaction dışında okunur; cüzdan yaratma
    // yarışı olursa createMany'nin skipDuplicates'i devreye girer.
    const existingWallets = await this.prisma.wallet.findMany({
      where: { userId: { in: allocations.map((a) => a.userId) } },
      select: { userId: true },
    });
    const hasWallet = new Set(existingWallets.map((w) => w.userId));

    await this.prisma.$transaction(
      async (tx) => {
        await tx.rewardLog.createMany({
          data: allocations.map((a) => ({
            userId: a.userId,
            seasonId,
            rank: a.rank,
            score: BigInt(Math.trunc(a.score)),
            amount: minorUnitsToDecimalString(a.amountMinor),
            status: 'DISTRIBUTED' as const,
            distributedAt,
          })),
        });

        // Cüzdanı olmayanlar tek seferde oluşturulur.
        const missing = allocations.filter((a) => !hasWallet.has(a.userId));
        if (missing.length > 0) {
          await tx.wallet.createMany({
            data: missing.map((a) => ({
              userId: a.userId,
              balance: minorUnitsToDecimalString(a.amountMinor),
              version: 1,
            })),
            skipDuplicates: true,
          });
        }

        // Mevcut cüzdanlar artırılır. increment satır bazlı olduğu için
        // bunlar tek sorguya indirgenemez; ama yalnızca mevcut cüzdanlar
        // kadardır ve hepsi aynı transaction içinde kalır.
        const updates = allocations
          .filter((a) => hasWallet.has(a.userId))
          .map((a) =>
            tx.wallet.update({
              where: { userId: a.userId },
              data: {
                balance: {
                  increment: minorUnitsToDecimalString(a.amountMinor),
                },
                version: { increment: 1 },
              },
            }),
          );
        await Promise.all(updates);
      },
      // Uzak veritabanına 100 oyunculuk dağıtım varsayılan 5s'yi aşabilir.
      { timeout: 30_000, maxWait: 10_000 },
    );

    return distributed;
  }
}
