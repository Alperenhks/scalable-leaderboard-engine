import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';

/**
 * Sağlık uçları.
 *
 * Prisma ve Redis global modüllerden, Mongo bağlantısı ise `@InjectConnection`
 * ile gelir; bu modülün kendi bağımlılığı yoktur.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
