import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaderboardController } from './controllers/leaderboard.controller';
import { LeaderboardService } from './services/leaderboard.service';
import { EventsService } from '../events/services/events.service';
import {
  ScoreEvent,
  ScoreEventSchema,
} from '../events/schemas/score-event.schema';

/**
 * PrismaModule ve RedisModule @Global() olduğundan burada import edilmez.
 *
 * ScoreEvent şeması forFeature ile burada kaydedilir — bu olmadan
 * @InjectModel çözümlenemez.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScoreEvent.name, schema: ScoreEventSchema },
    ]),
  ],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, EventsService],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
