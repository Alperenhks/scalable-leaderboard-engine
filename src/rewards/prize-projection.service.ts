import { Injectable } from '@nestjs/common';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import {
  allocatePrizePool,
  minorUnitsToDecimalString,
  REWARDED_PLAYER_COUNT,
} from './reward-math';

export interface PrizeProjectionEntry {
  rank: number;
  userId: string;
  amount: string;
}

export interface PrizeProjection {
  seasonId: string;
  poolAmount: string;
  rewardedPlayerCount: number;
  /** İlk 100'ün tahmini payları — sıra sırasına göre. */
  entries: PrizeProjectionEntry[];
  /** Token sahibinin kendi projeksiyonu (kimlik verilmişse). */
  me: {
    rank: number | null;
    score: number;
    amount: string;
    /** İlk 100'de değilse false — o durumda amount "0.00" olur. */
    isEligible: boolean;
    /** Ödül almaya başlamak için kaç puan gerektiği; zaten alıyorsa null. */
    pointsToEligible: number | null;
  } | null;
}

/**
 * Sezon bitse ŞU AN kim ne kazanırdı?
 *
 * Hesap sunucuda yapılır çünkü 4-100 aralığındaki pay skora ORANTILIDIR:
 * bir oyuncunun payını bilmek için ilk 100'ün TÜM skorlarının toplamı
 * gerekir. İlk 100 dışındaki bir oyuncunun istemcisinde bu veri yoktur ve
 * yalnızca kendi payını öğrenmek için 100 satır çekmesi gerekirdi.
 *
 * Daha önemlisi: tahmin, gerçek dağıtımla AYNI fonksiyonu (allocatePrizePool)
 * kullanır. Ayrı bir formül yazılsaydı ikisi zamanla ayrışır ve oyuncuya
 * gösterilen tutar ödenenden farklı olurdu — para tarafında kabul edilemez.
 */
@Injectable()
export class PrizeProjectionService {
  constructor(private readonly leaderboard: LeaderboardService) {}

  async project(
    seasonId: string,
    userId?: string,
  ): Promise<PrizeProjection> {
    const [poolMinor, candidates] = await Promise.all([
      this.leaderboard.getPrizePoolMinor(seasonId),
      this.leaderboard.getRewardCandidates(seasonId, REWARDED_PLAYER_COUNT),
    ]);

    // Dağıtımın kendisiyle birebir aynı hesap.
    const allocations = allocatePrizePool(poolMinor, candidates);
    const amountByUserId = new Map(
      allocations.map((a) => [a.userId, a.amountMinor]),
    );

    const entries: PrizeProjectionEntry[] = candidates.map((c) => ({
      rank: c.rank,
      userId: c.userId,
      amount: minorUnitsToDecimalString(amountByUserId.get(c.userId) ?? 0n),
    }));

    return {
      seasonId,
      poolAmount: minorUnitsToDecimalString(poolMinor),
      rewardedPlayerCount: REWARDED_PLAYER_COUNT,
      entries,
      me: userId ? await this.projectFor(userId, seasonId, candidates, amountByUserId) : null,
    };
  }

  private async projectFor(
    userId: string,
    seasonId: string,
    candidates: Array<{ userId: string; rank: number; score: number }>,
    amountByUserId: Map<string, bigint>,
  ): Promise<NonNullable<PrizeProjection['me']>> {
    const { rank, score } = await this.leaderboard.getUserRank(userId, seasonId);
    const amountMinor = amountByUserId.get(userId) ?? 0n;
    const isEligible = amountMinor > 0n;

    // İlk 100'ün dışındaysa: son ödül alan oyuncuyu geçmek için gereken fark.
    // Oyuncuya "ne kadar uzaktayım" sinyali verir — idle oyunda asıl motivasyon.
    let pointsToEligible: number | null = null;
    if (!isEligible) {
      const cutoff = candidates[REWARDED_PLAYER_COUNT - 1] ?? candidates.at(-1);
      if (cutoff) pointsToEligible = Math.max(1, cutoff.score - score + 1);
    }

    return {
      rank,
      score,
      amount: minorUnitsToDecimalString(amountMinor),
      isEligible,
      pointsToEligible,
    };
  }
}
