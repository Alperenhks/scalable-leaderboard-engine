import { IsSeasonId } from '../decorators/is-season-id.decorator';

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
  @IsSeasonId()
  seasonId?: string;
}
