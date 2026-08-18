import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { IsSeasonId } from '../../common/decorators/is-season-id.decorator';

/**
 * POST /api/auth/identify gövdesi.
 *
 * Şifre alanı YOKTUR ve bilinçli olarak yoktur: bu bir login akışı değil,
 * "hangi oyuncu olarak bakıyorum?" seçimidir. Case bir kimlik doğrulama
 * sistemi istemiyor; istediği, oyuncunun kendi sırasını görebilmesi.
 */
export class IdentifyDto {
  /**
   * Kimliğine bürünülecek oyuncu. Verilmezse `mode` devreye girer.
   *
   * Kullanıcı adı kabul edilir (cuid değil): frontend'in oyuncu listesinde
   * zaten görünen değer budur, araya kimlik eşlemesi koymak gereksizdir.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  username?: string;

  /**
   * Kullanıcı adı verilmediğinde hangi oyuncunun seçileceği.
   *
   * Jürinin tek tıkla farklı senaryoları denemesi için: `top` ilk sıradaki,
   * `mid` orta sıralardaki, `outside` ilk 100'ün DIŞINDAKİ (asıl test edilmek
   * istenen "3 üst / 2 alt" senaryosu), `unranked` ise hiç skoru olmayan
   * oyuncuyu döndürür.
   */
  @IsOptional()
  @IsIn(['top', 'contender', 'mid', 'outside', 'unranked', 'random'])
  mode?: 'top' | 'contender' | 'mid' | 'outside' | 'unranked' | 'random';

  /** Sezon bağlamı — `mode` ile oyuncu seçilirken hangi tabloya bakılacağı. */
  @IsSeasonId()
  seasonId?: string;
}
