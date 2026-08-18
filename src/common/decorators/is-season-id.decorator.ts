import { applyDecorators } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import { SEASON_ID_REGEX } from '../utils/season.util';

/**
 * Opsiyonel sezon kimliği doğrulaması.
 *
 * Aynı üç decorator ve aynı hata mesajı beş ayrı DTO'da tekrarlanıyordu;
 * dahası biri (`identify.dto.ts`) `SEASON_ID_REGEX` sabitini import etmek
 * yerine deseni elle kopyalamıştı — sabit değişse o dosya sessizce ayrışırdı.
 *
 * Tek yerde toplanması hem tekrarı kaldırır hem de doğrulamanın otoritesini
 * `season.util.ts`'e sabitler: sezon biçimini üreten ve doğrulayan kod artık
 * aynı kaynaktan besleniyor.
 */
export function IsSeasonId(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsString(),
    Matches(SEASON_ID_REGEX, {
      message: 'seasonId biçimi YYYY-Www olmalıdır, ör. 2026-W34',
    }),
  );
}
