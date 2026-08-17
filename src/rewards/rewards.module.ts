import { Module } from '@nestjs/common';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { RewardsScheduler } from './rewards.scheduler';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

/**
 * LeaderboardModule import edilir çünkü dağıtım, sıralamayı ve havuzu okuyup
 * sezonu sıfırlamak için LeaderboardService'e ihtiyaç duyar.
 * PrismaModule, RedisModule ve AuthModule @Global() olduğundan gerekmez.
 */
@Module({
  imports: [LeaderboardModule],
  controllers: [RewardsController],
  providers: [RewardsService, RewardsScheduler],
  exports: [RewardsService],
})
export class RewardsModule {}
