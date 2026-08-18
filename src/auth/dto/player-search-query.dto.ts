import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** GET /api/auth/players sorgu parametreleri. */
export class PlayerSearchQueryDto {
  /// Kullanıcı adında geçen metin; verilmezse tüm oyuncular sayfalanır.
  @IsOptional()
  @IsString()
  @Length(1, 64)
  search?: string;

  /**
   * Üst sınır 100: 10M kayıtlı oyuncuda sınırsız sayfa boyutu tek istekle
   * veritabanını doyurur.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset: number = 0;
}
