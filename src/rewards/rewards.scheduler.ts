import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RewardsService } from './rewards.service';
import { getCurrentSeasonId } from '../common/season.util';

/**
 * Haftalık otomatik dağıtım.
 *
 * Pazartesi 00:05 UTC: yeni ISO haftası başladıktan hemen sonra çalışır ve
 * BİTEN haftayı dağıtır. 5 dakikalık gecikme, hafta sınırında yolda olan
 * skor isteklerinin Redis'e yazılmasını bekler.
 *
 * Cron her instance'ta tetiklenir; mükerrer dağıtımı RewardsService'teki
 * Redis kilidi ve RewardLog'un (userId, seasonId) tekil kısıtı engeller.
 * Kaybeden instance ConflictException alır — bu beklenen durumdur, hata değil.
 */
@Injectable()
export class RewardsScheduler {
  private readonly logger = new Logger(RewardsScheduler.name);

  constructor(private readonly rewards: RewardsService) {}

  @Cron('5 0 * * 1', { timeZone: 'UTC', name: 'weekly-reward-distribution' })
  async distributePreviousWeek(): Promise<void> {
    const seasonId = getPreviousSeasonId();
    this.logger.log(`Haftalık dağıtım tetiklendi: ${seasonId}`);

    try {
      const result = await this.rewards.distributeSeason(seasonId);
      this.logger.log(
        `${seasonId}: ${result.rewardedCount} oyuncuya ${result.distributedAmount} dağıtıldı`,
      );
    } catch (error) {
      // Başka bir instance önce davrandıysa burası normal akıştır.
      this.logger.warn(
        `${seasonId} dağıtımı yapılmadı: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Bir önceki ISO haftasının kimliği — cron çalıştığında biten hafta budur. */
export function getPreviousSeasonId(now: Date = new Date()): string {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  return getCurrentSeasonId(sevenDaysAgo);
}
