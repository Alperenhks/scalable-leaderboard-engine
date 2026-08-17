import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, JwtPayload } from './jwt.types';

/**
 * Guard'ın isteğe iliştirdiği doğrulanmış kimliği controller'a taşır.
 *
 * `@CurrentUser('sub')` doğrudan userId verir. JwtAuthGuard olmadan kullanılırsa
 * değer undefined olur — bu yüzden ikisi her zaman birlikte kullanılmalıdır.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return data ? request.user?.[data] : request.user;
  },
);
