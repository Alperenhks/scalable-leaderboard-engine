import { IsSeasonId } from '../../common/decorators/is-season-id.decorator';

/**
 * Manuel dağıtım gövdesi.
 *
 * seasonId burada İSTEMCİDEN alınır — skor gönderiminin aksine. Sebep: dağıtım
 * doğası gereği BİTMİŞ bir sezona uygulanır, o anki sezona değil. Verilmezse
 * bir önceki hafta varsayılır.
 */
export class DistributeSeasonDto {
  @IsSeasonId()
  seasonId?: string;
}
