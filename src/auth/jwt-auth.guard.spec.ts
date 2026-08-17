import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './jwt.types';

const SECRET = 'test-secret-en-az-16-karakter';

/** Sahte ExecutionContext: yalnızca guard'ın okuduğu alanları taşır. */
function contextWith(headers: Record<string, string>): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const request: Partial<AuthenticatedRequest> = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: SECRET });
  const guard = new JwtAuthGuard(jwt);

  it('geçerli token ile geçer ve sub değerini isteğe iliştirir', () => {
    const token = jwt.sign({ sub: 'user-123', username: 'alperen' });
    const { context, request } = contextWith({
      authorization: `Bearer ${token}`,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user?.sub).toBe('user-123');
    expect(request.user?.username).toBe('alperen');
  });

  it('Bearer şemasını büyük/küçük harf duyarsız kabul eder', () => {
    const token = jwt.sign({ sub: 'user-123' });
    const { context } = contextWith({ authorization: `bearer ${token}` });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('Authorization header yoksa reddeder', () => {
    const { context } = contextWith({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('Bearer olmayan şemayı reddeder', () => {
    const { context } = contextWith({ authorization: 'Basic abc123' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('imzası geçersiz token reddedilir', () => {
    const foreign = new JwtService({ secret: 'baska-bir-gizli-anahtar' });
    const token = foreign.sign({ sub: 'user-123' });
    const { context } = contextWith({ authorization: `Bearer ${token}` });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('süresi dolmuş token reddedilir', () => {
    const token = jwt.sign({ sub: 'user-123' }, { expiresIn: '-1s' });
    const { context } = contextWith({ authorization: `Bearer ${token}` });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('sub taşımayan token reddedilir', () => {
    // sub olmadan kimlik belirlenemez; sessizce geçirmek kimlik sahteciliğine
    // kapı açardı.
    const token = jwt.sign({ username: 'alperen' });
    const { context } = contextWith({ authorization: `Bearer ${token}` });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('boş Bearer değeri reddedilir', () => {
    const { context } = contextWith({ authorization: 'Bearer ' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
