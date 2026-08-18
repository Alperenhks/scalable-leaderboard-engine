import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LeaderboardService } from '../../leaderboard/services/leaderboard.service';
import { Role } from '../types/jwt.types';
import { IdentifyDto } from '../dto/identify.dto';

export interface IdentifyResult {
  token: string;
  userId: string;
  username: string;
  roles: Role[];
  /** Seçilen oyuncunun o anki sırası — frontend'in ilk ekranı için ipucu. */
  rank: number | null;
  score: number;
  seasonId: string;
}

/**
 * Kimlik SEÇİMİ — kimlik doğrulama değil.
 *
 * Case login istemiyor ama "oyuncu kendi sırasını görsün" diyor; kendi
 * sırasını görmek için sunucunun kim olduğunu bilmesi yeter, kanıtlaması
 * gerekmez. Üretilen token gerçek bir JWT'dir ve korumalı uçlar onu normal
 * guard'dan geçirir — mimari üretim kalitesindedir, yalnızca kanıtlama adımı
 * yoktur.
 *
 * `mode` parametresi senaryoları tek çağrıyla açar: ilk 100 dışındaki bir
 * oyuncu olarak bakmak için tabloyu tarayıp kullanıcı adı aramak gerekmez.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  async identify(
    dto: IdentifyDto,
    currentSeasonId: string,
  ): Promise<IdentifyResult> {
    const seasonId = dto.seasonId ?? currentSeasonId;

    const user = dto.username
      ? await this.findByUsername(dto.username)
      : await this.pickByMode(dto.mode ?? 'random', seasonId);

    const roles: Role[] = [Role.PLAYER];

    const { rank, score } = await this.leaderboard.getUserRank(
      user.id,
      seasonId,
    );

    return {
      // Token gerçek JWT'dir: aynı JWT_SECRET ile imzalanır ve korumalı uçlar
      // onu üretimdekiyle birebir aynı guard'dan geçirir.
      token: this.jwt.sign({ sub: user.id, username: user.username, roles }),
      userId: user.id,
      username: user.username,
      roles,
      rank,
      score,
      seasonId,
    };
  }

  private async findByUsername(
    username: string,
  ): Promise<{ id: string; username: string }> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true },
    });

    if (!user) {
      throw new NotFoundException(`Oyuncu bulunamadı: ${username}`);
    }
    return user;
  }

  /**
   * Sıralamadaki konuma göre oyuncu seçer.
   *
   * Seçim Redis üzerinden yapılır (Postgres'te ORDER BY DEĞİL): tablo
   * sıralaması zaten ZSET'in işidir ve bu uç da aynı disipline uyar.
   */
  private async pickByMode(
    mode: NonNullable<IdentifyDto['mode']>,
    seasonId: string,
  ): Promise<{ id: string; username: string }> {
    // Skoru hiç olmayan oyuncu: rank null senaryosunu denemek için.
    if (mode === 'unranked') {
      const candidate = await this.findUnrankedUser(seasonId);
      if (candidate) return candidate;
      // Herkesin skoru varsa sessizce sıralamadan seçmeye düşülür.
    }

    const total = await this.leaderboard.getPlayerCount(seasonId);
    if (total === 0) {
      throw new NotFoundException(
        `${seasonId} sezonunda hiç oyuncu yok — önce "npm run seed" çalıştırın`,
      );
    }

    const index = this.indexForMode(mode, total);
    const [userId] = await this.leaderboard.getUserIdsAtRange(
      seasonId,
      index,
      index,
    );

    if (!userId) {
      throw new NotFoundException(`${seasonId} sezonunda oyuncu bulunamadı`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });

    // ZSET'te olup Postgres'te olmayan kayıt: tutarsız veri, sessiz geçilmez.
    if (!user) {
      throw new NotFoundException(
        `Sıralamadaki oyuncu Postgres'te bulunamadı: ${userId}`,
      );
    }
    return user;
  }

  private indexForMode(
    mode: NonNullable<IdentifyDto['mode']>,
    total: number,
  ): number {
    switch (mode) {
      case 'top':
        return 0;
      // İlk 100'ün içinde ama zirvede değil. Case'in "ilk 100'ü görüyorum
      // ama kendimi bulamıyorum" şikâyeti tam bu oyuncunun durumudur:
      // tabloda görünür, ancak kaydırmadan kendini fark edemez.
      case 'contender':
        return Math.min(total - 1, 52);
      case 'mid':
        return Math.floor(total / 2);
      // Asıl gösterilmek istenen senaryo: ilk 100'ün dışı. Tablo 100'den
      // kısaysa en sona düşülür.
      case 'outside':
        return Math.min(total - 1, 120);
      default:
        return Math.floor(Math.random() * total);
    }
  }

  /**
   * Sıralamada yeri olmayan bir oyuncu bulur ("bu hafta hiç oynamamış").
   *
   * ZSET üyeliği Redis'te, kullanıcı listesi Postgres'te olduğu için kesişim
   * uygulama katmanında alınır. Bir örneklem çekilip üyelikleri TEK pipeline
   * ile sorgulanır: oyuncu başına ayrı ZSCORE, 500 kayıtta 500 gidiş-dönüş
   * demek olurdu.
   *
   * Örneklem `id` sırasına göre alınır, `createdAt`'e göre değil: seed toplu
   * insert kullandığı için binlerce kaydın createdAt'i aynı milisaniyeye
   * düşer ve sıralama belirsizleşir — sırasız oyuncular hiç bulunamazdı.
   */
  private async findUnrankedUser(
    seasonId: string,
  ): Promise<{ id: string; username: string } | null> {
    const SAMPLE_SIZE = 500;
    const sample = await this.prisma.user.findMany({
      select: { id: true, username: true },
      orderBy: { id: 'desc' },
      take: SAMPLE_SIZE,
    });

    if (sample.length === 0) return null;

    const ranks = await this.leaderboard.getRanksOf(
      seasonId,
      sample.map((u) => u.id),
    );

    return sample.find((_, i) => ranks[i] === null) ?? null;
  }
}
