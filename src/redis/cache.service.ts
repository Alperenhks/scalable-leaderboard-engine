import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Genel amaçlı Redis cache erişimi.
 *
 * `LeaderboardService`'ten AYRI tutuldu ve bu bilinçli: cüzdan özetini
 * cache'lemenin liderlik tablosuyla kavramsal bir ilgisi yok. Önceden bu
 * metotlar orada duruyordu ve `PlayersService`, cüzdan bakiyesini cache'lemek
 * için `LeaderboardService`'i enjekte etmek zorunda kalıyordu — sıralamayla
 * hiç işi olmadığı hâlde.
 *
 * Redis client'ı `@Global()` bir modülden geldiği için her servis kendi
 * bağımlılığını doğrudan alabilir; aracı bir servis üzerinden geçmeye gerek
 * yoktur ve ikinci bir bağlantı da açılmaz.
 */
@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  /** Verilen anahtarları siler; boş liste güvenlidir (`DEL` argümansız hata verir). */
  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.redis.del(...keys);
  }
}
