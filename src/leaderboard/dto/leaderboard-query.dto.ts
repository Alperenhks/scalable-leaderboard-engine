import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SEASON_ID_REGEX } from '../../common/season.util';

/**
 * GET /api/leaderboard sorgu parametreleri.
 *
 * limit/offset seçildi (page/pageSize değil): ZREVRANGE start stop'a birebir
 * oturur, araya aritmetik girmez ve offset zaten ilk satırın 0-tabanlı sırasıdır.
 */
export class LeaderboardQueryDto {
  /**
   * Type(() => Number) burada zorunludur: query string değerleri metin olarak
   * gelir, onsuz IsInt "10" değerini reddeder.
   *
   * Üst sınır 100: sınırsız bırakılırsa ZREVRANGE 0 1999999 tek iş parçacıklı
   * Redis'i tüm filo için kilitler — tek istekle kolay bir DoS olurdu.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset: number = 0;

  /// Geçmiş sezon okumaları zararsız ve kullanışlıdır; yazmanın aksine serbesttir.
  /// Verilmezse sunucu o anki sezonu kullanır.
  @IsOptional()
  @IsString()
  @Matches(SEASON_ID_REGEX, {
    message: 'seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34',
  })
  seasonId?: string;
}
