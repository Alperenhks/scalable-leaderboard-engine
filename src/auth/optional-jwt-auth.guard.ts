import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedRequest, JwtPayload } from './jwt.types';

/**
 * Token VARSA doğrular, yoksa isteği yine de geçirir.
 *
 * JwtAuthGuard'dan farkı: kimlik zorunlu değildir. Ödül projeksiyonu gibi
 * uçlar herkese açık bir tablo döndürür ama token taşıyan isteğe ek olarak
 * "senin payın" bilgisini de ekler. Zorunlu guard kullanılsaydı tabloyu
 * görmek için de kimlik gerekirdi; hiç guard kullanılmasaydı kişiye özel
 * kısım imkânsız olurdu.
 *
 * Geçersiz token sessizce yok sayılır (401 atılmaz): uç kimliksiz de
 * anlamlıdır, bozuk bir token'ın tabloyu tamamen engellemesi gerekmez.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    if (!header) return true;

    const [scheme, token] = header.split(' ');
    if (!token || scheme?.toLowerCase() !== 'bearer') return true;

    try {
      const payload = this.jwt.verify<JwtPayload>(token.trim());
      if (payload.sub) (request as AuthenticatedRequest).user = payload;
    } catch {
      // Kimlik yokmuş gibi devam edilir.
    }
    return true;
  }
}
