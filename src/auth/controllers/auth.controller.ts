import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { IdentifyDto } from '../dto/identify.dto';
import { PlayerSearchQueryDto } from '../dto/player-search-query.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { getCurrentSeasonId } from '../../common/utils/season.util';

/** Oyuncu kimliği seçimi — login değil (gerekçesi `AuthService`'te). */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Bir oyuncunun kimliğine bürünür ve o oyuncu için JWT üretir.
   *
   * Gövde tamamen opsiyoneldir: boş bir POST rastgele bir oyuncu döndürür,
   * yani frontend hiçbir ön bilgi olmadan çalışmaya başlayabilir.
   */
  @Post('identify')
  async identify(@Body() dto: IdentifyDto) {
    return this.auth.identify(dto, getCurrentSeasonId());
  }

  /**
   * Oyuncu arama/listeleme — frontend'in "oyuncu seçici" ekranı için.
   *
   * Sayfa boyutu sınırlıdır: 10M kayıtlı oyuncuda sınırsız liste tek istekle
   * veritabanını doyururdu.
   */
  @Get('players')
  async searchPlayers(@Query() query: PlayerSearchQueryDto) {
    const where = query.search
      ? { username: { contains: query.search, mode: 'insensitive' as const } }
      : {};

    const [players, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, username: true, country: true },
        orderBy: { createdAt: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { total, limit: query.limit, offset: query.offset, players };
  }
}
