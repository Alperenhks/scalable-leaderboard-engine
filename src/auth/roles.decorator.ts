import { SetMetadata } from '@nestjs/common';
import type { Role } from './jwt.types';

export const ROLES_KEY = 'required_roles';

/**
 * Bir ucun gerektirdiği rolleri işaretler.
 *
 * Birden fazla rol verilirse **herhangi biri** yeterlidir (OR mantığı).
 * RolesGuard ile birlikte kullanılır; tek başına bir etkisi yoktur.
 *
 * @example
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles(Role.ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
