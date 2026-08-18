import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

/**
 * Oyuncunun kendine dair verilerini toplar.
 *
 * Para bilgisi Postgres'ten, sıralama Redis'ten gelir — her deponun
 * sorumluluğu korunur. İki depo tek yanıtta birleştirilir ki frontend
 * açılış ekranı için tek istek atsın.
 */
@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** Açılış ekranı için birleşik durum: kimlik + sıra + bakiye + son ödül. */
  async getSummary(userId: string, seasonId: string) {
    // Kullanıcı adı ve ülke için ayrı bir Postgres sorgusu ATILMAZ: ikisi de
    // liderlik tablosunun zaten doldurduğu profil cache'inde bulunur. Bu uç
    // açılış ekranında her oyuncu tarafından çağrıldığı için üç ayrı sorgu,
    // eşzamanlı yükte bağlantı havuzunu tüketen asıl etkendi (ölçüldü:
    // 43 RPS -> cache ile belirgin artış).
    const [profile, position, wallet, lastReward] = await Promise.all([
      this.leaderboard.getProfile(userId),
      this.leaderboard.getUserRank(userId, seasonId),
      this.prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true, updatedAt: true },
      }),
      this.prisma.rewardLog.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          seasonId: true,
          rank: true,
          amount: true,
          status: true,
          distributedAt: true,
        },
      }),
    ]);

    return {
      userId,
      username: profile?.username ?? null,
      country: profile?.country ?? null,
      seasonId,
      rank: position.rank,
      score: position.score,
      // Decimal string'e çevrilir: JSON'da Number'a düşerse para alanında
      // kayan nokta hassasiyeti kaybolur.
      balance: wallet ? wallet.balance.toString() : '0.0000',
      lastReward: lastReward
        ? { ...lastReward, amount: lastReward.amount.toString() }
        : null,
    };
  }

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true, version: true, updatedAt: true },
    });

    // Cüzdan yalnızca ilk ödülde yaratılır; yokluğu hata değil, sıfır bakiyedir.
    return {
      userId,
      balance: wallet ? wallet.balance.toString() : '0.0000',
      version: wallet?.version ?? 0,
      updatedAt: wallet?.updatedAt ?? null,
    };
  }

  /** Ödül geçmişi — en yeni sezon başta. */
  async getRewardHistory(userId: string) {
    const rewards = await this.prisma.rewardLog.findMany({
      where: { userId },
      orderBy: { seasonId: 'desc' },
      select: {
        seasonId: true,
        rank: true,
        score: true,
        amount: true,
        status: true,
        distributedAt: true,
      },
      // Bir oyuncunun sezon sayısı sınırlıdır ama uç yine de sınırsız
      // bırakılmaz: yıllar sonra bu liste büyür.
      take: 52,
    });

    const totalEarnedMinor = rewards.reduce(
      (sum, r) => sum + BigInt(Math.round(Number(r.amount) * 100)),
      0n,
    );

    return {
      userId,
      count: rewards.length,
      totalEarned: (Number(totalEarnedMinor) / 100).toFixed(2),
      rewards: rewards.map((r) => ({
        ...r,
        // BigInt ve Decimal JSON'a doğrudan serileşmez.
        score: r.score.toString(),
        amount: r.amount.toString(),
      })),
    };
  }
}
