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
import { TOP_WINDOW_SIZE } from '../leaderboard.service';

/**
 * GET /api/leaderboard/around sorgu parametreleri.
 *
 * `limit` yalnızca oyuncu ilk 100'ün İÇİNDEYKEN anlamlıdır (o durumda tablonun
 * başı döndürülür). İlk 100 dışındaysa pencere sabittir: 3 üst + kendisi + 2 alt.
 */
export class AroundQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TOP_WINDOW_SIZE)
  limit: number = TOP_WINDOW_SIZE;

  @IsOptional()
  @IsString()
  @Matches(SEASON_ID_REGEX, {
    message: 'seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34',
  })
  seasonId?: string;
}
