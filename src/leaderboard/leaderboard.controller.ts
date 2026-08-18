import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { SubmitScoreDto } from './dto/submit-score.dto';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { AroundQueryDto } from './dto/around-query.dto';
import { SeasonQueryDto } from '../common/dto/season-query.dto';
import { getCurrentSeasonId } from '../common/season.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller()
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  /**
   * Skor gönderimi.
   *
   * Kimlik gövdeden DEĞİL, doğrulanmış token'ın `sub` alanından alınır —
   * kimlik sahteciliği böylece kapanır. Guard tamamen bellekte çalışır
   * (HMAC imza kontrolü), veritabanına gitmez: yazma yolunun gecikmesi
   * değişmez.
   *
   * Sezon istek başında bir kez türetilip aşağı geçirilir; hafta sınırında
   * ZINCRBY ile Mongo kaydının farklı sezonlara düşmesi böylece imkânsızdır.
   */
  @Post('score')
  @UseGuards(JwtAuthGuard)
  async submitScore(
    @Body() dto: SubmitScoreDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.leaderboard.submitScore(
      userId,
      dto.delta,
      dto.source,
      getCurrentSeasonId(),
      dto.idempotencyKey,
    );
  }

  @Get('leaderboard')
  async getLeaderboard(@Query() query: LeaderboardQueryDto) {
    return this.leaderboard.getTopPlayers(
      query.seasonId ?? getCurrentSeasonId(),
      query.limit,
      query.offset,
      query.country,
    );
  }

  /**
   * "3 üst, 2 alt" penceresi — oyuncu ilk 100 dışındaysa bile kaybolmaz.
   *
   * Kimlik token'dan alınır: bir oyuncunun başkasının çevresini sorgulaması
   * için bir sebep yok ve userId'yi parametre yapmak gereksiz bir bilgi
   * sızıntısı yüzeyi açardı.
   */
  @Get('leaderboard/around')
  @UseGuards(JwtAuthGuard)
  async getAround(
    @Query() query: AroundQueryDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.leaderboard.getAround(
      userId,
      query.seasonId ?? getCurrentSeasonId(),
      query.limit,
      query.country,
    );
  }

  /**
   * Oyuncunun kendi sırası — tabloyu çekmeden tek kayıt sorgusu.
   *
   * seasonId ham @Query yerine DTO ile alınır: ValidationPipe yalnızca DTO
   * sınıfları üzerinde çalışır, ham string parametrede devreye girmez. Ham
   * bırakıldığında geçersiz bir sezon (ör. "BADFORMAT") 400 yerine 200
   * dönüyor ve doğrulanmamış girdi Redis anahtar adına giriyordu.
   */
  @Get('leaderboard/rank')
  @UseGuards(JwtAuthGuard)
  async getUserRank(
    @CurrentUser('sub') userId: string,
    @Query() query: SeasonQueryDto,
  ) {
    return this.leaderboard.getUserRank(
      userId,
      query.seasonId ?? getCurrentSeasonId(),
    );
  }
}
