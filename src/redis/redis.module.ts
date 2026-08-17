import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Canlı liderlik tablosunun taşıyıcısı.
 *
 * Sıralama Redis Sorted Set üzerinde tutulur: ZADD ile skor güncellemesi ve
 * ZREVRANK ile sıra sorgusu O(log N)'dir — 2M oyuncuda dahi tek işlemde döner.
 * Aynı sorguyu Postgres'te ORDER BY + OFFSET ile yapmak tablo taraması
 * gerektirir ve bu ölçekte sürdürülemez.
 *
 * API katmanı stateless kalır: hiçbir sıralama durumu process belleğinde
 * tutulmaz, tüm durum Redis'tedir. Böylece sunucu yatayda serbestçe çoğaltılır.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        // Bağlantı adresi yalnızca .env'den okunur, koda gömülmez.
        const url = config.getOrThrow<string>('REDIS_URL');
        return new Redis(url, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
