import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlayersService } from '../services/players.service';
import { SeasonQueryDto } from '../../common/dto/season-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getCurrentSeasonId } from '../../common/utils/season.util';

/**
 * Oyuncunun kendine dair verileri — case'in "reward/status communication"
 * gereksinimini karşılayan uçlar.
 *
 * Hepsi token'daki kimliğe bağlıdır; başka bir oyuncunun cüzdanı veya ödül
 * geçmişi hiçbir uçtan okunamaz. Bu bilinçlidir: sıralama herkese açıktır ama
 * para bilgisi değildir.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  /**
   * Tek çağrıda oyuncunun tam durumu: sıra, skor, bakiye, son ödül.
   *
   * Frontend'in açılış ekranı bu verilerin hepsini birden ister; ayrı ayrı
   * uçlara bölmek mobil bağlantıda üç ayrı gidiş-dönüş demek olurdu.
   */
  @Get()
  async getMe(
    @CurrentUser('sub') userId: string,
    @Query() query: SeasonQueryDto,
  ) {
    return this.players.getSummary(
      userId,
      query.seasonId ?? getCurrentSeasonId(),
    );
  }

  @Get('wallet')
  async getWallet(@CurrentUser('sub') userId: string) {
    return this.players.getWallet(userId);
  }

  @Get('rewards')
  async getRewards(@CurrentUser('sub') userId: string) {
    return this.players.getRewardHistory(userId);
  }
}
