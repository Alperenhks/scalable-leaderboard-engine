import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { RewardsService } from '../services/rewards.service';
import { LeaderboardService } from '../../leaderboard/services/leaderboard.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';

/**
 * Dağıtımın davranış sözleşmesi.
 *
 * Buradaki testler para hesabını değil (o `reward-math.spec.ts`'te) **sırayı
 * ve korumaları** sınar: kilit alınamazsa ne olur, sezon zaten dağıtılmışsa
 * ne olur ve en önemlisi — Redis hangi anda sıfırlanır.
 *
 * Son madde case'in 6. gereksinimidir (*"both the pool and the leaderboard
 * reset"*) ve sırası kritiktir: Redis, Postgres'e yazıldıktan SONRA
 * sıfırlanmalıdır. Ters sırada dağıtım yarıda kalırsa sıralama ve havuz geri
 * getirilemez. Kod okumakla doğrulanabilen ama sessizce bozulabilen bir
 * değişmez olduğu için testle sabitlendi.
 */
describe('RewardsService.distributeSeason', () => {
  const SEASON = '2026-W20';

  /** Çağrıların hangi sırada yapıldığını kaydeden iz. */
  let trace: string[];

  const build = async (opts: {
    lockAcquired?: boolean;
    alreadyDistributed?: number;
    poolMinor?: bigint;
    candidates?: Array<{ userId: string; rank: number; score: number }>;
    knownUserIds?: string[];
  }) => {
    trace = [];
    const {
      lockAcquired = true,
      alreadyDistributed = 0,
      poolMinor = 1_000_000n,
      candidates = Array.from({ length: 5 }, (_, i) => ({
        userId: `u${i + 1}`,
        rank: i + 1,
        score: 1000 - i * 10,
      })),
      knownUserIds = ['u1', 'u2', 'u3', 'u4', 'u5'],
    } = opts;

    const moduleRef = await Test.createTestingModule({
      providers: [
        RewardsService,
        {
          provide: REDIS_CLIENT,
          useValue: {
            set: () => Promise.resolve(lockAcquired ? 'OK' : null),
            del: () => Promise.resolve(1),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            rewardLog: {
              count: () => Promise.resolve(alreadyDistributed),
              createMany: () => {
                trace.push('postgres:rewardLog');
                return Promise.resolve({ count: candidates.length });
              },
            },
            wallet: {
              findMany: () => Promise.resolve([]),
              createMany: () => {
                trace.push('postgres:wallet');
                return Promise.resolve({ count: candidates.length });
              },
              update: () => Promise.resolve({}),
            },
            user: {
              findMany: () =>
                Promise.resolve(knownUserIds.map((id) => ({ id }))),
            },
            $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
              // Gerçek Prisma transaction'ı gibi: callback'e tx nesnesi geçer.
              const tx = {
                rewardLog: {
                  createMany: () => {
                    trace.push('postgres:rewardLog');
                    return Promise.resolve({ count: candidates.length });
                  },
                },
                wallet: {
                  createMany: () => {
                    trace.push('postgres:wallet');
                    return Promise.resolve({ count: 0 });
                  },
                  update: () => Promise.resolve({}),
                },
              };
              return fn(tx);
            },
          },
        },
        {
          provide: LeaderboardService,
          useValue: {
            getPrizePoolMinor: () => Promise.resolve(poolMinor),
            getRewardCandidates: () => Promise.resolve(candidates),
            resetSeason: () => {
              trace.push('redis:reset');
              return Promise.resolve();
            },
          },
        },
        {
          provide: CacheService,
          useValue: {
            delete: () => {
              trace.push('cache:invalidate');
              return Promise.resolve();
            },
          },
        },
      ],
    }).compile();

    return moduleRef.get(RewardsService);
  };

  describe('case md.6 — havuz ve sıralama sıfırlanır', () => {
    it('Redis, Postgres yazımından SONRA sıfırlanır', async () => {
      const service = await build({});

      await service.distributeSeason(SEASON);

      const pgIndex = trace.indexOf('postgres:rewardLog');
      const resetIndex = trace.indexOf('redis:reset');

      expect(pgIndex).toBeGreaterThanOrEqual(0);
      expect(resetIndex).toBeGreaterThanOrEqual(0);
      // Ters sırada dağıtım yarıda kalırsa sıralama geri getirilemez.
      expect(pgIndex).toBeLessThan(resetIndex);
    });

    it('cache geçersizleştirme de Postgres yazımından sonra gelir', async () => {
      const service = await build({});

      await service.distributeSeason(SEASON);

      // Önce silinseydi, yazma tamamlanmadan gelen bir istek eski değeri
      // yeniden cache'lerdi.
      expect(trace.indexOf('postgres:rewardLog')).toBeLessThan(
        trace.indexOf('cache:invalidate'),
      );
    });

    it('sonuç seasonReset işaretiyle döner', async () => {
      const service = await build({});

      const result = await service.distributeSeason(SEASON);

      expect(result.seasonReset).toBe(true);
      expect(result.seasonId).toBe(SEASON);
      expect(result.rewardedCount).toBeGreaterThan(0);
    });
  });

  describe('idempotency', () => {
    it('kilit alınamazsa 409 verir ve hiçbir yazma yapmaz', async () => {
      const service = await build({ lockAcquired: false });

      await expect(service.distributeSeason(SEASON)).rejects.toThrow(
        ConflictException,
      );
      expect(trace).toEqual([]);
    });

    it('sezon zaten dağıtılmışsa 409 verir ve Redis sıfırlanmaz', async () => {
      const service = await build({ alreadyDistributed: 100 });

      await expect(service.distributeSeason(SEASON)).rejects.toThrow(
        ConflictException,
      );
      // En kritik nokta: ikinci çağrı tabloyu SİLMEMELİ.
      expect(trace).not.toContain('redis:reset');
    });
  });

  describe('dağıtılacak bir şey yoksa', () => {
    it('havuz boşsa sıralama sıfırlanmaz', async () => {
      const service = await build({ poolMinor: 0n });

      const result = await service.distributeSeason(SEASON);

      expect(result.rewardedCount).toBe(0);
      expect(result.seasonReset).toBe(false);
      // Boş bir dağıtım, canlı sıralamayı yok etmemeli.
      expect(trace).not.toContain('redis:reset');
    });

    it('hiç aday yoksa sıralama sıfırlanmaz', async () => {
      const service = await build({ candidates: [] });

      const result = await service.distributeSeason(SEASON);

      expect(result.rewardedCount).toBe(0);
      expect(trace).not.toContain('redis:reset');
    });
  });

  describe('tutarsız veri', () => {
    it("Postgres'te bulunmayan kazananları atlar, dağıtımı düşürmez", async () => {
      // ZSET'te var ama Postgres'te yok: FK ihlali tüm transaction'ı
      // düşürürdü, bu yüzden önceden elenir.
      const service = await build({ knownUserIds: ['u1', 'u2'] });

      const result = await service.distributeSeason(SEASON);

      expect(result.skippedUnknownUsers).toBe(3);
      expect(result.rewardedCount).toBe(2);
      expect(result.seasonReset).toBe(true);
    });
  });
});
