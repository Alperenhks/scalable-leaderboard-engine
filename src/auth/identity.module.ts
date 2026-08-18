import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

/**
 * Oyuncu kimliği seçimi (login değil).
 *
 * AuthModule'den AYRI tutuldu ve bilinçli olarak öyle: AuthModule @Global()'dir
 * ve guard'ları tüm uygulamaya sağlar. LeaderboardModule'ü oraya import etmek,
 * global bir modülü bir özellik modülüne bağımlı kılardı — kurulum sırasında
 * döngü riski doğurur. Kimlik SEÇİMİ ise sıradan bir özelliktir; sıralamaya
 * ihtiyaç duyduğu için burada, normal bir modül olarak durur.
 */
@Module({
  imports: [LeaderboardModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class IdentityModule {}
