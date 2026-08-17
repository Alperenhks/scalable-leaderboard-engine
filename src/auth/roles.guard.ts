import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import type { AuthenticatedRequest, Role } from './jwt.types';

/**
 * Rol tabanlı yetki kontrolü (RBAC) — sıfır I/O.
 *
 * JwtAuthGuard'dan AYRI tutuldu: o "kimsin?" sorusunu yanıtlar (401), bu ise
 * "bunu yapmaya yetkin var mı?" sorusunu (403). İkisini tek sınıfta birleştirmek
 * kimlik doğrulamayı her uçta rol bilgisine bağımlı hale getirirdi.
 *
 * Rol token'ın içinden okunur; veritabanına sorgu gitmez. Kimlik doğrulamada
 * korunan gecikme disiplini burada da korunur.
 *
 * SIRALAMA ÖNEMLİ: @UseGuards(JwtAuthGuard, RolesGuard) — RolesGuard,
 * JwtAuthGuard'ın isteğe iliştirdiği `user` alanına bağımlıdır. Ters sırada
 * yazılırsa rol kontrolü daima kimlik bulunamadı hatası verir.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Handler'daki @Roles() controller'dakini gölgeler.
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // @Roles() konmamış uçlar bu guard'dan serbest geçer; korumayı açan
    // decorator'ın kendisidir.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      // Guard sırası yanlış kurulmuş demektir — sessizce geçirmek, korumalı
      // bir ucu tamamen açık bırakırdı.
      throw new UnauthorizedException('Kimlik doğrulanmamış');
    }

    const granted = user.roles ?? [];
    const allowed = required.some((role) => granted.includes(role));

    if (!allowed) {
      // Hangi rolün gerektiği söylenir; bu bir bilgi sızıntısı değil, istemcinin
      // doğru token'ı istemesini sağlayan yararlı bir sinyaldir.
      throw new ForbiddenException(
        `Bu işlem için gerekli rol: ${required.join(' veya ')}`,
      );
    }

    return true;
  }
}
