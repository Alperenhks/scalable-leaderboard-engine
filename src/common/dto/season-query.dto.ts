import { IsOptional, IsString, Matches } from 'class-validator';
import { SEASON_ID_REGEX } from '../season.util';

/**
 * Yalnızca `seasonId` taşıyan sorgular için ortak DTO.
 *
 * Varlık sebebi: ham `@Query('seasonId') seasonId?: string` parametreleri
 * ValidationPipe'a hiç uğramaz — pipe yalnızca DTO SINIFLARI üzerinde çalışır.
 * Bu yüzden bazı uçlar "BADFORMAT" gibi geçersiz bir sezonu 200 ile kabul
 * ederken diğerleri 400 veriyordu. Doğrulamayı tek bir sınıfta toplamak bu
 * tutarsızlığı kapatır ve doğrulanmamış girdinin Redis anahtar adına
 * girmesini engeller.
 */
export class SeasonQueryDto {
  @IsOptional()
  @IsString()
  @Matches(SEASON_ID_REGEX, {
    message: 'seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34',
  })
  seasonId?: string;
}
