/**
 * Redis client'ının DI token'ı.
 *
 * `redis.module.ts` yerine AYRI bir dosyada: `CacheService` token'a ihtiyaç
 * duyar, modül de `CacheService`'i provider olarak kaydeder. İkisi aynı
 * dosyada olsaydı dairesel import oluşur ve token çalışma zamanında
 * `undefined` gelirdi — Nest bunu "can't resolve dependencies" hatasıyla
 * bildirir, TypeScript derlemesi ise sorunsuz geçer.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';
