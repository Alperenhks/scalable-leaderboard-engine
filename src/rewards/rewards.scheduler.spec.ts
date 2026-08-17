import { getPreviousSeasonId } from './rewards.scheduler';
import { getCurrentSeasonId } from '../common/season.util';

describe('getPreviousSeasonId', () => {
  it('bir önceki ISO haftasını verir', () => {
    // 18 Ağustos 2026 Salı -> 2026-W34; bir önceki hafta 2026-W33.
    expect(getPreviousSeasonId(new Date('2026-08-18T00:05:00Z'))).toBe(
      '2026-W33',
    );
  });

  /**
   * Cron Pazartesi 00:05 UTC'de çalışır. O an yeni hafta başlamıştır; dağıtımın
   * BİTEN haftaya uygulanması gerekir — bu testin asıl amacı budur.
   */
  it('cron anında biten haftayı hedefler, o anki haftayı değil', () => {
    const cronMoment = new Date('2026-08-17T00:05:00Z'); // Pazartesi
    const current = getCurrentSeasonId(cronMoment);
    const previous = getPreviousSeasonId(cronMoment);

    expect(current).toBe('2026-W34');
    expect(previous).toBe('2026-W33');
    expect(previous).not.toBe(current);
  });

  it('yıl sınırında bir önceki yılın son haftasına döner', () => {
    // 4 Ocak 2027 Pazartesi -> 2027-W01; öncesi 2026-W53.
    expect(getPreviousSeasonId(new Date('2027-01-04T00:05:00Z'))).toBe(
      '2026-W53',
    );
  });
});
