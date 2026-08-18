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
   * Admin yetkili token istemek için paylaşılan sır.
   *
   * Daha önce burada serbest bir `role: "admin"` alanı vardı ve isteyen
   * herkes ödül dağıtımını tetikleyebilecek bir token alabiliyordu — canlı
   * dağıtımda para dağıtan uç fiilen açıktı.
   *
   * Sır `ADMIN_SECRET` ortam değişkeninden okunur ve sabit zamanlı
   * karşılaştırmayla doğrulanır. Değişken tanımlı değilse admin token'ı
   * HİÇ üretilmez: yapılandırılmamış bir ortamda ucun kapalı kalması,
   * yanlışlıkla açık kalmasına yeğdir.
   *
   * Bu bir login akışı değildir; case zaten kimlik doğrulama istemiyor.
   * Haftalık dağıtım cron ile otomatik çalışır (`rewards.scheduler.ts`) —
   * bu uç yalnızca dağıtımın elle gösterilebilmesi için vardır.
   */
  @IsOptional()
  @IsString()
  adminSecret?: string;

  /** Sezon bağlamı — `mode` ile oyuncu seçilirken hangi tabloya bakılacağı. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, {
    message: 'seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34',
  })
  seasonId?: string;
}
