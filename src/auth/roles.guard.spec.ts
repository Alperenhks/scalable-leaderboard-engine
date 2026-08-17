import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from './jwt.types';
import type { JwtPayload } from './jwt.types';

/**
 * Sahte ExecutionContext + Reflector.
 *
 * Gerçek Reflector yerine sabit değer döndüren bir taklit kullanılır: burada
 * sınanan şey metadata okuma mekanizması değil, rol karşılaştırma mantığıdır.
 */
function makeGuard(requiredRoles: Role[] | undefined, user?: JwtPayload) {
  const reflector = {
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector;

  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  return { guard: new RolesGuard(reflector), context };
}

const admin: JwtPayload = { sub: 'u1', roles: [Role.ADMIN] };
const player: JwtPayload = { sub: 'u2', roles: [Role.PLAYER] };

describe('RolesGuard', () => {
  it('admin rolü gerektiren uca admin geçebilir', () => {
    const { guard, context } = makeGuard([Role.ADMIN], admin);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('admin gerektiren uca player 403 alır', () => {
    const { guard, context } = makeGuard([Role.ADMIN], player);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  /**
   * En kritik senaryo: rol taşımayan token yetki YÜKSELTMEMELİ.
   * Eski token'lar veya elle üretilmiş payload'lar bu yoldan geçer.
   */
  it('roles alanı taşımayan token admin ucuna giremez', () => {
    const { guard, context } = makeGuard([Role.ADMIN], { sub: 'u3' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('boş roles dizisi yetki vermez', () => {
    const { guard, context } = makeGuard([Role.ADMIN], {
      sub: 'u4',
      roles: [],
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('@Roles konmamış uç serbest geçer', () => {
    const { guard, context } = makeGuard(undefined, player);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('boş @Roles() listesi kısıtlama saymaz', () => {
    const { guard, context } = makeGuard([], player);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('birden fazla rolde herhangi biri yeterlidir', () => {
    const { guard, context } = makeGuard([Role.ADMIN, Role.PLAYER], player);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('birden fazla role sahip kullanıcı geçer', () => {
    const both: JwtPayload = { sub: 'u5', roles: [Role.PLAYER, Role.ADMIN] };
    const { guard, context } = makeGuard([Role.ADMIN], both);

    expect(guard.canActivate(context)).toBe(true);
  });

  /**
   * Guard sırası yanlış kurulduysa (RolesGuard, JwtAuthGuard'dan önce) istekte
   * `user` bulunmaz. Sessizce geçirmek korumalı ucu tamamen açık bırakırdı.
   */
  it('kimlik iliştirilmemişse 401 verir, sessizce geçirmez', () => {
    const { guard, context } = makeGuard([Role.ADMIN], undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('403 mesajı gereken rolü bildirir', () => {
    const { guard, context } = makeGuard([Role.ADMIN], player);

    expect(() => guard.canActivate(context)).toThrow(/admin/);
  });
});
