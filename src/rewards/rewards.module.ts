import { Module } from '@nestjs/common';
import { RewardsController } from './controllers/rewards.controller';
import { RewardsService } from './services/rewards.service';
import { PrizeProjectionService } from './services/prize-projection.service';
import { RewardsScheduler } from './schedulers/rewards.scheduler';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

/**
 * LeaderboardModule import edilir çünkü dağıtım, sıralamayı ve havuzu okuyup
 * sezonu sıfırlamak için LeaderboardService'e ihtiyaç duyar.
 * PrismaModule, RedisModule ve AuthModule @Global() olduğundan gerekmez.
 */
@Module({
  imports: [LeaderboardModule],
  controllers: [RewardsController],
  providers: [RewardsService, RewardsScheduler, PrizeProjectionService],
  exports: [RewardsService],
})
export class RewardsModule {}
