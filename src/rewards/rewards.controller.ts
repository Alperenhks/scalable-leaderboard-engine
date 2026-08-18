import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { PrizeProjectionService } from './prize-projection.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { DistributeSeasonDto } from './dto/distribute-season.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  getCurrentSeasonId,
  getSeasonEndsAt,
  getSeasonStartsAt,
} from '../common/season.util';
import { SeasonQueryDto } from '../common/dto/season-query.dto';
import { getPreviousSeasonId } from './rewards.scheduler';
import {
  minorUnitsToDecimalString,
  PRIZE_POOL_RATE,
  REMAINDER_SHARE,
  REWARDED_PLAYER_COUNT,
  TOP_SHARES,
} from './reward-math';

@Controller('rewards')
export class RewardsController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly leaderboard: LeaderboardService,
    private readonly projection: PrizeProjectionService,
  ) {}

  /**
   * Sezonun o ana kadar biriken ödül havuzu.
   *
   * seasonId ham @Query yerine DTO ile alınır — ValidationPipe ham string
   * parametrelerde çalışmaz ve bu uç geçersiz sezonu 200 ile kabul ediyordu.
   */
  @Get('pool')
  async getPool(@Query() query: SeasonQueryDto) {
    const season = query.seasonId ?? getCurrentSeasonId();
    const poolMinor = await this.leaderboard.getPrizePoolMinor(season);

    return {
      seasonId: season,
      poolAmount: minorUnitsToDecimalString(poolMinor),
    };
  }

  /**
   * Sezon durumu — frontend'in geri sayımı ve ödül tablosu için.
   *
   * Bitiş anı SUNUCUDA hesaplanır: istemcinin yerel saatine bırakılsaydı
   * farklı saat dilimlerindeki oyuncular farklı bir sezon sonu görürdü,
   * oysa sezon sınırı herkes için aynı UTC anıdır.
   *
   * Ödül oranları da buradan yayınlanır ki frontend bunları kendi içine
   * sabitlemek zorunda kalmasın — oran değişirse tek kaynaktan değişir.
   */
  @Get('season')
  async getSeasonStatus(@Query() query: SeasonQueryDto) {
    const season = query.seasonId ?? getCurrentSeasonId();
    const now = new Date();
    const endsAt = getSeasonEndsAt(now);
    const startsAt = getSeasonStartsAt(now);

    const [poolMinor, playerCount] = await Promise.all([
      this.leaderboard.getPrizePoolMinor(season),
      this.leaderboard.getPlayerCount(season),
    ]);

    const isCurrent = season === getCurrentSeasonId();

    return {
      seasonId: season,
      isCurrentSeason: isCurrent,
      // Geçmiş bir sezon sorulduysa geri sayım anlamsızdır.
      startsAt: isCurrent ? startsAt.toISOString() : null,
      endsAt: isCurrent ? endsAt.toISOString() : null,
      secondsRemaining: isCurrent
        ? Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 1000))
        : null,
      serverTime: now.toISOString(),
      poolAmount: minorUnitsToDecimalString(poolMinor),
      playerCount,
      prizePoolRate: PRIZE_POOL_RATE,
      rewardedPlayerCount: REWARDED_PLAYER_COUNT,
      distribution: {
        first: TOP_SHARES[0],
        second: TOP_SHARES[1],
        third: TOP_SHARES[2],
        remaining: REMAINDER_SHARE,
      },
    };
  }

  /**
   * "Sezon şu an bitse kim ne kazanır?" — ilk 100'ün tahmini payları.
   *
   * Hesap sunucuda yapılır çünkü 4-100 aralığındaki pay skora ORANTILIDIR:
   * bir oyuncunun payını bilmek ilk 100'ün tüm skorlarının toplamını
   * gerektirir. İlk 100 dışındaki oyuncunun istemcisinde bu veri yoktur.
   *
   * Kimlik OPSİYONELDİR: token'sız istek yalnızca tabloyu alır, token'lı
   * istek ek olarak `me` alanında kendi payını da alır.
   */
  @Get('projection')
  @UseGuards(OptionalJwtAuthGuard)
  async getProjection(
    @Query() query: SeasonQueryDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.projection.project(
      query.seasonId ?? getCurrentSeasonId(),
      userId,
    );
  }

  /**
   * Dağıtımı elle tetikler — değerlendirme kolaylığı için.
   *
   * Asıl dağıtım yolu bu DEĞİLDİR: `RewardsScheduler` her Pazartesi 00:05 UTC
   * çalışır ve biten haftayı kendiliğinden dağıtır (case: *"Rewards should go
   * out automatically at the end of the week"*). Bu uç yalnızca, sezonun
   * bitmesini beklemeden dağıtımın çalıştığını görebilmek için vardır.
   *
   * Kimlik doğrulaması bilinçli olarak YOKTUR. Case bir yetkilendirme sistemi
   * istemiyor; demo ortamında rol katmanı, denemek isteyen kişiye yalnızca
   * engel çıkarırdı. Gerçek bir dağıtımda bu uç kaldırılır — cron zaten
   * yeterlidir.
   *
   * Ucun yıkıcılığı guard ile değil İDEMPOTENCY ile sınırlanır: aynı sezon
   * ikinci kez dağıtılamaz (`RewardLog(userId, seasonId)` tekil kısıtı → 409)
   * ve eşzamanlı çağrılar Redis kilidine takılır. Art arda çağırmak çift
   * ödeme üretemez; en kötü ihtimalle sezon erken kapanır ve tablo sıfırlanır
   * (`npm run seed -- --reset` ile geri gelir).
   */
  @Post('distribute')
  async distribute(@Body() dto: DistributeSeasonDto) {
    const seasonId = dto.seasonId ?? getPreviousSeasonId();
    return this.rewards.distributeSeason(seasonId);
  }
}
