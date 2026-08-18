import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

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
  @IsIn(['top', 'mid', 'outside', 'unranked', 'random'])
  mode?: 'top' | 'mid' | 'outside' | 'unranked' | 'random';

  /**
   * Admin yetkili token isteniyorsa. Ödül dağıtımı ucunu denemek için gerekli.
   *
   * Demo ortamında serbest bırakılması bilinçlidir: jüri dağıtımı canlı
   * görebilmelidir. Gerçek bir dağıtımda bu alan kaldırılmalı ve admin
   * token'ı yalnızca sunucu tarafında üretilmelidir (README'de not düşüldü).
   */
  @IsOptional()
  @IsIn(['player', 'admin'])
  role?: 'player' | 'admin';

  /** Sezon bağlamı — `mode` ile oyuncu seçilirken hangi tabloya bakılacağı. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, {
    message: 'seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34',
  })
  seasonId?: string;
}
