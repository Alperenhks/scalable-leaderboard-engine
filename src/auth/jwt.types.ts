import type { FastifyRequest } from 'fastify';

/**
 * Sistemdeki roller.
 *
 * Rol token'ın içinde taşınır, veritabanında tutulmaz: yetki kontrolü de
 * kimlik doğrulama gibi sıfır I/O kalmalıdır. Rol değişikliği yeni token
 * gerektirir — token ömrü 7 gün olduğu için bu, yetki geri alma ihtiyacı
 * doğduğunda dikkat edilmesi gereken bir noktadır (aşağıdaki nota bakınız).
 */
export const Role = {
  PLAYER: 'player',
  ADMIN: 'admin',
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
