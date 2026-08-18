import { Module } from '@nestjs/common';
import { PlayersController } from './controllers/players.controller';
import { PlayersService } from './services/players.service';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

/** Oyuncunun kendine dair verileri: cüzdan, ödül geçmişi, birleşik durum. */
@Module({
  imports: [LeaderboardModule],
  controllers: [PlayersController],
  providers: [PlayersService],
})
export class PlayersModule {}
