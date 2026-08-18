import type { FastifyRequest } from 'fastify';

/**
 * Sistemdeki roller.
 *
 * Şu an tek bir rol vardır: case bir yetkilendirme sistemi istemiyor ve
 * korunması gereken bir uç yok — haftalık ödül dağıtımı cron ile otomatik
 * çalışır. Önceden bir `ADMIN` rolü ve onu kontrol eden bir `RolesGuard`
 * tanımlıydı ama hiçbir uca bağlı değildi; kullanılmayan bir yetki katmanı
 * taşımak yerine kaldırıldı.
 *
 * Alan token'ın içinde taşınır, veritabanında tutulmaz: yetki kontrolü de
 * kimlik doğrulama gibi sıfır I/O kalmalıdır. Gerçek bir rol ihtiyacı
 * doğduğunda buraya yeni değer eklemek yeterlidir.
 */
export const Role = {
  PLAYER: 'player',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/**
 * Token'ın taşıdığı doğrulanmış kimlik.
 *
 * `sub` JWT'nin standart "subject" alanıdır ve burada Postgres User.id (cuid)
 * değerini taşır. Guard bunu istek nesnesine iliştirir; controller artık
 * kimliği gövdeden değil buradan okur.
 *
 * `roles` opsiyoneldir: taşımayan token'lar sıradan oyuncu sayılır. Böylece
 * mevcut token'lar geçersiz olmaz ve yetki yükseltmesi ancak açıkça rol
 * verilmiş token'larla mümkün olur — varsayılan daima en az yetkidir.
 */
export interface JwtPayload {
  sub: string;
  username?: string;
  roles?: Role[];
  iat?: number;
  exp?: number;
}

/** Guard'dan geçmiş istek: `user` alanı garanti altındadır. */
export type AuthenticatedRequest = FastifyRequest & { user: JwtPayload };
