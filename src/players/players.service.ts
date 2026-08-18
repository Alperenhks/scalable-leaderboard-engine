import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

/**
 * Cüzdan özeti cache ömrü.
 *
 * Bakiye YALNIZCA haftalık ödül dağıtımında değişir ve o an cache açıkça
 * geçersiz kılınır (`RewardsService`). TTL bu yüzden uzun tutulabilir; tek
 * işlevi, geçersiz kılma bir şekilde kaçırılırsa verinin sonsuza dek eski
 * kalmasını önlemektir.
 */
const ACCOUNT_CACHE_TTL_SECONDS = 3_600;

/**
 * Para alanlarını sabit 4 ondalıkla string'e çevirir.
 *
 * Prisma'nın `Decimal.toString()`'i sondaki sıfırları atar: aynı alan bazen
 * "90", bazen "0.0000" döner. Şema `Decimal(18,4)` olduğu için biçim de
 * sabit olmalıdır — istemci `Number`'a çevirmeden doğrudan gösterebilsin.
 */
function toMoney(value: { toFixed(n: number): string } | null | undefined): string {
  return value ? value.toFixed(4) : '0.0000';
}

interface CachedAccount {
  balance: string;
  lastReward: {
    seasonId: string;
    rank: number;
    amount: string;
    status: string;
    distributedAt: string | null;
  } | null;
}

/**
 * Oyuncunun kendine dair verilerini toplar.
 *
 * Para bilgisi Postgres'in otoritesindedir ama okuma yolu oraya her istekte
 * gitmez: ölçüm, Postgres'e giden uçların eşzamanlılıkla ölçeklenmediğini
 * (p50 76ms -> 489ms), yalnızca Redis'e gidenlerin ölçeklendiğini gösterdi.
 * Bakiye haftada bir değiştiği için cache'lenmeye en uygun veridir.
 */
@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** Oyuncunun cüzdan/ödül özeti için cache anahtarı. */
  static accountKey(userId: string): string {
    return `account:${userId}`;
  }

  /** Açılış ekranı için birleşik durum: kimlik + sıra + bakiye + son ödül. */
  async getSummary(userId: string, seasonId: string) {
    // Kullanıcı adı ve ülke için ayrı bir Postgres sorgusu ATILMAZ: ikisi de
    // liderlik tablosunun zaten doldurduğu profil cache'inde bulunur. Bu uç
    // açılış ekranında her oyuncu tarafından çağrıldığı için üç ayrı sorgu,
    // eşzamanlı yükte bağlantı havuzunu tüketen asıl etkendi (ölçüldü:
    // 43 RPS -> cache ile belirgin artış).
    const [profile, position, account] = await Promise.all([
      this.leaderboard.getProfile(userId),
      this.leaderboard.getUserRank(userId, seasonId),
      this.getAccount(userId),
    ]);

    return {
      userId,
      username: profile?.username ?? null,
      country: profile?.country ?? null,
      seasonId,
      rank: position.rank,
      score: position.score,
      balance: account.balance,
      lastReward: account.lastReward,
    };
  }

  /**
   * Cüzdan bakiyesi ve son ödül — önce cache, yoksa Postgres.
   *
   * Bu ikisi birlikte cache'lenir çünkü ikisi de yalnızca ödül dağıtımında
   * değişir ve hep birlikte okunur. Ayrı ayrı tutmak iki Redis çağrısı
   * demek olurdu.
   */
  private async getAccount(userId: string): Promise<CachedAccount> {
    const key = PlayersService.accountKey(userId);

    const cached = await this.leaderboard.cacheGet(key);
    if (cached) {
      try {
        return JSON.parse(cached) as CachedAccount;
      } catch {
        // Bozuk kayıt cache'i kilitlemesin; Postgres'ten tazelenir.
      }
    }

    const [wallet, lastReward] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true },
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

    const account: CachedAccount = {
      // Decimal string'e çevrilir: JSON'da Number'a düşerse para alanında
      // kayan nokta hassasiyeti kaybolur. toFixed(4) şart — Prisma'nın
      // Decimal.toString()'i sondaki sıfırları atar ve aynı alan bazen
      // "90", bazen "0.0000" döner; istemci tarafında bu tutarsızlık
      // biçimlendirmeyi bozar.
      balance: toMoney(wallet?.balance),
      lastReward: lastReward
        ? {
            ...lastReward,
            amount: toMoney(lastReward.amount),
            distributedAt: lastReward.distributedAt?.toISOString() ?? null,
          }
        : null,
    };

    await this.leaderboard.cacheSet(
      key,
      JSON.stringify(account),
      ACCOUNT_CACHE_TTL_SECONDS,
    );
    return account;
  }

  /**
   * Cüzdan bakiyesi.
   *
   * Bakiye `/me` ile AYNI cache'ten okunur; iki uç ayrı kaynaktan beslenseydi
   * aynı ekranda farklı tutarlar görünebilirdi. `version` ve `updatedAt`
   * cache'lenmez — bunlar optimistic locking için sunucu tarafı alanlardır ve
   * yalnızca ihtiyaç duyulduğunda Postgres'ten okunur.
   */
  async getWallet(userId: string) {
    const account = await this.getAccount(userId);
    return { userId, balance: account.balance };
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
        // BigInt JSON'a doğrudan serileşmez; para ise sabit biçimde döner.
        score: r.score.toString(),
        amount: toMoney(r.amount),
      })),
    };
  }
}
