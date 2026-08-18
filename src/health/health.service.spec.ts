import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Sağlık yoklaması testleri.
 *
 * Üç depo da sahte (mock) verilir: amaç gerçek bağlantıyı değil, KARAR
 * mantığını sınamaktır — hangi durumda `degraded` denir, düşen bağımlılık
 * raporda görünür mü, bir depo asılı kaldığında uç yine de yanıt döner mi.
 */
describe('HealthService', () => {
  const build = async (overrides: {
    postgres?: () => Promise<unknown>;
    redis?: () => Promise<unknown>;
    mongo?: () => Promise<unknown>;
  }) => {
    const ok = () => Promise.resolve(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: { $queryRaw: overrides.postgres ?? ok },
        },
        {
          provide: REDIS_CLIENT,
          useValue: { ping: overrides.redis ?? ok },
        },
        {
          provide: getConnectionToken(),
          useValue: { db: { admin: () => ({ ping: overrides.mongo ?? ok }) } },
        },
      ],
    }).compile();

    return moduleRef.get(HealthService);
  };

  it('üç depo da ayaktayken ok döner', async () => {
    const report = await (await build({})).check();

    expect(report.status).toBe('ok');
    expect(report.dependencies.postgres.status).toBe('up');
    expect(report.dependencies.redis.status).toBe('up');
    expect(report.dependencies.mongo.status).toBe('up');
  });

  it('tek bir depo düşse bile degraded olur ve hangisi olduğu görünür', async () => {
    const service = await build({
      redis: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.dependencies.redis.status).toBe('down');
    expect(report.dependencies.redis.error).toContain('ECONNREFUSED');
    // Diğerleri etkilenmez: rapor sorunu İZOLE etmelidir.
    expect(report.dependencies.postgres.status).toBe('up');
    expect(report.dependencies.mongo.status).toBe('up');
  });

  it('bir depo asılı kalırsa zaman aşımıyla down sayar, uç asılı kalmaz', async () => {
    const service = await build({
      // Hiç çözülmeyen promise: yanıt vermeyen veritabanı.
      postgres: () => new Promise<never>(() => {}),
    });

    const startedAt = Date.now();
    const report = await service.check();
    const elapsed = Date.now() - startedAt;

    expect(report.dependencies.postgres.status).toBe('down');
    expect(report.status).toBe('degraded');
    // Zaman aşımı 2 sn; sonsuza kadar beklememeli.
    expect(elapsed).toBeLessThan(4_000);
  }, 10_000);

  it('yoklamalar paralel çalışır — süre toplanmaz', async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 300));
    const service = await build({ postgres: slow, redis: slow, mongo: slow });

    const startedAt = Date.now();
    await service.check();
    const elapsed = Date.now() - startedAt;

    // Sırayla çalışsaydı ~900 ms olurdu.
    expect(elapsed).toBeLessThan(700);
  });

  it('raporda uptime ve zaman damgası bulunur', async () => {
    const report = await (await build({})).check();

    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
  });
});
