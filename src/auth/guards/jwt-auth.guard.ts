import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedRequest, JwtPayload } from '../types/jwt.types';

/**
 * Stateless JWT doğrulaması — sıfır I/O.
 *
 * Doğrulama tamamen bellekte, JWT_SECRET ile HMAC imza kontrolü olarak yapılır.
 * Ne Postgres'e ne Redis'e sorgu gider: yazma yolunun (POST /api/score) gecikmesi
 * değişmez. 2M DAU'da her istekte bir kullanıcı tablosu sorgusu, tam da bu
 * mimarinin kaçındığı yükü geri getirirdi.
 *
 * Token'ın `sub` alanı istek nesnesine iliştirilir; controller kimliği artık
 * istek gövdesinden değil buradan okur — kimlik sahteciliği böylece kapanır.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'Authorization header eksik veya Bearer biçiminde değil',
      );
    }

    let payload: JwtPayload;
    try {
      // verify() senkron ve saf CPU işidir — ağ çağrısı yapmaz.
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      // Hatanın ayrıntısı (süresi dolmuş / imza geçersiz) istemciye sızdırılmaz.
      throw new UnauthorizedException('Token geçersiz veya süresi dolmuş');
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Token sub (userId) alanı taşımıyor');
    }

    (request as AuthenticatedRequest).user = payload;
    return true;
  }

  /** "Bearer <token>" ayrıştırması; şema adı büyük/küçük harf duyarsızdır. */
  private extractBearerToken(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, token] = header.split(' ');
    if (!token || scheme?.toLowerCase() !== 'bearer') return null;

    return token.trim() || null;
  }
}
