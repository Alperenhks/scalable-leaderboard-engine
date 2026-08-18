import { Module } from '@nestjs/common';
import { RewardsController } from './controllers/rewards.controller';
import { RewardsService } from './services/rewards.service';
import { PrizeProjectionService } from './services/prize-projection.service';
import { RewardsScheduler } from './schedulers/rewards.scheduler';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

/** Ödül havuzu, haftalık dağıtım ve sezon durumu. */
@Module({
  imports: [LeaderboardModule],
  controllers: [RewardsController],
  providers: [RewardsService, RewardsScheduler, PrizeProjectionService],
  exports: [RewardsService],
})
export class RewardsModule {}
