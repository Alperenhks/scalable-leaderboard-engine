import { IsOptional, IsString, Matches } from 'class-validator';
import { SEASON_ID_REGEX } from '../../common/season.util';

/**
 * Manuel dağıtım gövdesi.
 *
 * seasonId burada İSTEMCİDEN alınır — skor gönderiminin aksine. Sebep: dağıtım
 * doğası gereği BİTMİŞ bir sezona uygulanır, o anki sezona değil. Verilmezse
 * bir önceki hafta varsayılır.
 */
export class DistributeSeasonDto {
  @IsOptional()
  @IsString()
  @Matches(SEASON_ID_REGEX, {
    message: 'seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34',
  })
  seasonId?: string;
}
