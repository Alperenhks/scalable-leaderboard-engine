import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { DistributeSeasonDto } from './dto/distribute-season.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/jwt.types';
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
   * Manuel dağıtım tetikleyicisi — YALNIZCA admin.
   *
   * Para dağıtan bir uç, kimliği doğrulanmış olsa bile herkese açık olamaz:
   * sıradan bir oyuncunun sezonu erken kapatıp ödülleri tetikleyebilmesi
   * gerçek bir ekonomi açığıdır.
   *
   * İki guard birlikte çalışır ve SIRA ÖNEMLİDİR: JwtAuthGuard kimliği
   * doğrulayıp isteğe iliştirir (401), RolesGuard bu kimliğin yetkisini
   * kontrol eder (403).
   */
  @Post('distribute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async distribute(@Body() dto: DistributeSeasonDto) {
    const seasonId = dto.seasonId ?? getPreviousSeasonId();
    return this.rewards.distributeSeason(seasonId);
  }
}
