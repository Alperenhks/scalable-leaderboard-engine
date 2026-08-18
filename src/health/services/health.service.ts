import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface DependencyHealth {
  status: 'up' | 'down';
  /** Yoklamanın sürdüğü süre (ms) — yavaşlayan bir bağımlılık böyle görünür. */
  latencyMs: number;
  /** Yalnızca `down` iken dolu olur. */
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  timestamp: string;
  dependencies: {
    postgres: DependencyHealth;
    redis: DependencyHealth;
    mongo: DependencyHealth;
  };
}

/**
 * Yoklama üst sınırı.
 *
 * Bir bağımlılık yanıt vermiyorsa health ucu onunla birlikte asılı kalmamalı:
 * orchestrator'ın probe timeout'u dolar ve sağlıklı olan instance da
 * gereksiz yere yeniden başlatılır. Bu süre dolduğunda o bağımlılık `down`
 * sayılır ve rapor yine de döner.
 */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Üç veri deposunun gerçek canlılığını ölçer.
 *
 * "Süreç ayakta" ile "süreç iş yapabiliyor" aynı şey değildir: Node ayakta
 * olduğu hâlde Postgres bağlantı havuzu tükenmiş ya da Redis erişilemez
 * olabilir. Bu durumda sağlıklı görünen bir instance'a trafik yönlendirmek,
 * isteklerin hata almasıyla sonuçlanır — bu yüzden yoklama bağımlılıklara
 * kadar iner.
 *
 * Yoklamalar PARALEL yapılır ve her birinin ayrı zaman aşımı vardır: sırayla
 * yapılsaydı üç bağımlılığın da yavaş olduğu durumda süre toplanırdı.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectConnection() private readonly mongo: Connection,
  ) {}

  async check(): Promise<HealthReport> {
    const [postgres, redis, mongo] = await Promise.all([
      this.probe('postgres', () => this.prisma.$queryRaw`SELECT 1`),
      this.probe('redis', () => this.redis.ping()),
      // `db` yalnızca bağlantı kurulduktan sonra tanımlıdır; kurulmadıysa
      // burada atılan hata zaten `down` olarak raporlanır.
      this.probe('mongo', () => this.mongo.db!.admin().ping()),
    ]);

    const dependencies = { postgres, redis, mongo };
    const allUp = Object.values(dependencies).every((d) => d.status === 'up');

    return {
      status: allUp ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  /**
   * Tek bir bağımlılığı yoklar; asla hata fırlatmaz.
   *
   * Fırlatsaydı tek bir depo yüzünden health ucu 500 dönerdi ve hangi
   * bağımlılığın düştüğü görünmezdi. Amaç tam tersi: rapor her koşulda
   * dönmeli ve sorunu işaret etmeli.
   */
  private async probe(
    name: string,
    fn: () => Promise<unknown>,
  ): Promise<DependencyHealth> {
    const startedAt = Date.now();

    try {
      // Zamanlayıcı `finally`'de temizlenir: yoklama zaman aşımından önce
      // dönerse askıda kalan bir timer süreci ayakta tutar (Jest'in
      // "did not exit" uyarısının ve üretimde gecikmeli kapanmanın sebebi).
      let timer: NodeJS.Timeout | undefined;

      try {
        await Promise.race([
          fn(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error(`${PROBE_TIMEOUT_MS} ms içinde yanıt yok`)),
              PROBE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }

      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Sağlık yoklaması başarısız (${name}): ${message}`);

      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        error: message,
      };
    }
  }
}
