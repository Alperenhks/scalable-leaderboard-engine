import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { TOP_WINDOW_SIZE } from '../leaderboard.service';
import { IsSeasonId } from '../../common/decorators/is-season-id.decorator';

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

  @IsSeasonId()
  seasonId?: string;

  /**
   * Verilirse sıralama o ülkeyle SINIRLANIR (global tablo yerine ülke
   * tablosu okunur). Ayrı bir Redis ZSET olduğu için maliyeti global
   * sorguyla aynıdır — global tabloyu çekip filtrelemek 2M üyede tüm
   * sıralamayı taramak demek olurdu.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'country ISO 3166-1 alpha-2 olmalıdır, ör. TR',
  })
  country?: string;
}
