import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { DistributeSeasonDto } from './dto/distribute-season.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/jwt.types';
import { getCurrentSeasonId } from '../common/season.util';
import { getPreviousSeasonId } from './rewards.scheduler';
import { minorUnitsToDecimalString } from './reward-math';

@Controller('rewards')
export class RewardsController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** Sezonun o ana kadar biriken ödül havuzu. */
  @Get('pool')
  async getPool(@Query('seasonId') seasonId?: string) {
    const season = seasonId ?? getCurrentSeasonId();
    const poolMinor = await this.leaderboard.getPrizePoolMinor(season);

    return {
      seasonId: season,
      poolAmount: minorUnitsToDecimalString(poolMinor),
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
