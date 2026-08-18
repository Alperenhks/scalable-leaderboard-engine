import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';

/** Liveness ve readiness uçları. */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
