import { Module } from '@nestjs/common';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

/**
 * Oyuncunun kendine dair verileri: cüzdan, ödül geçmişi, birleşik durum.
 *
 * LeaderboardModule import edilir çünkü özet yanıtı sırayı da taşır.
 * PrismaModule ve AuthModule @Global() olduğundan gerekmez.
 */
@Module({
  imports: [LeaderboardModule],
  controllers: [PlayersController],
  providers: [PlayersService],
})
export class PlayersModule {}
