import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * POST /api/score gövdesi.
 *
 * Ne `userId` ne `seasonId` burada yer alır — ikisi de sunucu tarafından
 * belirlenir: kimlik doğrulanmış token'dan, sezon o anki ISO haftasından.
 * İstemciye bırakılsalardı biri kimlik sahteciliğine, diğeri kapanmış bir
 * sezona skor yazmaya açık olurdu. main.ts'teki forbidNonWhitelisted sayesinde
 * bu alanları gönderen istek otomatik 400 alır.
 */
export class SubmitScoreDto {
  /**
   * userId burada YOKTUR: kimlik doğrulanmış JWT'nin `sub` alanından alınır.
   * Gövdeden alınsaydı herkes başkası adına skor gönderebilirdi. Gönderilirse
   * forbidNonWhitelisted otomatik 400 verir.
   */

  /**
   * Bu event'te eklenen fark — mutlak skor değil. Negatif değer ceza/düzeltme
   * senaryosu için serbesttir.
   *
   * IsNumber değil IsInt: ZSET skorları IEEE 754 double'dır, 2^53 üstünde
   * tamsayı hassasiyeti kaybolur ve eşitlik sıralaması belirsizleşir.
   *
   * Sınırlar şart: sınırsız bırakılırsa istemci 1e308 gönderip kalıcı olarak
   * 1. sıraya çakılabilir, Infinity ise ZINCRBY'yi patlatıp 500 üretir.
   * Sınır bunu temiz bir 400'e çevirir.
   */
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  delta!: number;

  /// Skorun kaynağı, ör. "idle_tick", "quest_complete", "purchase".
  /// Desen kısıtı alanı düşük kardinaliteli tutar; analitik tarafta gruplanabilir kalır.
  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'source yalnızca küçük harf, rakam ve alt çizgi içerebilir',
  })
  source!: string;

  /// Tekrar gönderimde çift sayımı önleyen istemci anahtarı.
  /// Mongo'daki unique-sparse index bunun tek doğruluk sınırıdır.
  @IsOptional()
  @IsString()
  @Length(8, 128)
  idempotencyKey?: string;
}
