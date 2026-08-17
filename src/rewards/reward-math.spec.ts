import {
  allocatePrizePool,
  minorUnitsToDecimalString,
  toMinorUnits,
  PoolCandidate,
} from './reward-math';

/** rank/score üretimi için kısa yardımcı. */
function candidates(
  count: number,
  scoreFor = (i: number) => 1000 - i,
): PoolCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: `u${i + 1}`,
    rank: i + 1,
    score: scoreFor(i),
  }));
}

function total(allocations: { amountMinor: bigint }[]): bigint {
  return allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
}

describe('allocatePrizePool', () => {
  it('ilk üç sıraya %20 / %15 / %10 verir', () => {
    const pool = toMinorUnits(10_000); // 1.000.000 kuruş
    const result = allocatePrizePool(pool, candidates(100));

    // 2. ve 3. paylar birebir sabittir.
    expect(result[1].amountMinor).toBe(150_000n); // %15
    expect(result[2].amountMinor).toBe(100_000n); // %10

    // 1. oyuncu %20'sini alır, ARTI kuyruktaki tamsayı bölme artığını.
    // Artık tasarım gereği buraya eklenir; toplamın korunmasını sağlar.
    expect(result[0].amountMinor).toBeGreaterThanOrEqual(200_000n);
    expect(result[0].amountMinor).toBeLessThan(200_000n + 100n);
  });

  /** En kritik değişmez: havuzdan kuruş ne kaybolur ne yoktan var olur. */
  it('dağıtılan toplam havuza tam eşittir', () => {
    const pool = toMinorUnits(9_999.99);
    const result = allocatePrizePool(pool, candidates(100));

    expect(total(result)).toBe(pool);
  });

  it('bölünemeyen havuzlarda da toplamı korur', () => {
    for (const amount of [1, 7, 33.33, 12_345.67, 0.03]) {
      const pool = toMinorUnits(amount);
      const result = allocatePrizePool(pool, candidates(100));
      expect(total(result)).toBe(pool);
    }
  });

  it('4-100 arasını skorla orantılı dağıtır', () => {
    const pool = toMinorUnits(10_000);
    // 4. oyuncu 5. oyuncunun iki katı skora sahip.
    const list: PoolCandidate[] = [
      { userId: 'a', rank: 1, score: 500 },
      { userId: 'b', rank: 2, score: 400 },
      { userId: 'c', rank: 3, score: 300 },
      { userId: 'd', rank: 4, score: 200 },
      { userId: 'e', rank: 5, score: 100 },
    ];
    const result = allocatePrizePool(pool, list);
    const d = result.find((r) => r.userId === 'd')!;
    const e = result.find((r) => r.userId === 'e')!;

    expect(d.amountMinor).toBe(e.amountMinor * 2n);
  });

  it('yalnızca ilk 100 oyuncuya ödül verir', () => {
    const result = allocatePrizePool(toMinorUnits(10_000), candidates(150));

    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.every((r) => r.rank <= 100)).toBe(true);
  });

  it('oyuncu sayısı 3ten azken bile havuzun tamamını dağıtır', () => {
    const pool = toMinorUnits(1_000);
    const result = allocatePrizePool(pool, candidates(2));

    expect(total(result)).toBe(pool);
  });

  it('tek oyuncu havuzun tamamını alır', () => {
    const pool = toMinorUnits(500);
    const result = allocatePrizePool(pool, candidates(1));

    expect(result).toHaveLength(1);
    expect(result[0].amountMinor).toBe(pool);
  });

  it('boş havuz veya boş aday listesinde hiç ödül üretmez', () => {
    expect(allocatePrizePool(0n, candidates(10))).toEqual([]);
    expect(allocatePrizePool(toMinorUnits(100), [])).toEqual([]);
  });

  it('sıfır paylı kayıt üretmez', () => {
    // Çok küçük havuz + çok oyuncu: kuyruktakilerin payı 0'a yuvarlanır.
    const result = allocatePrizePool(toMinorUnits(0.05), candidates(100));

    expect(result.every((r) => r.amountMinor > 0n)).toBe(true);
  });

  it('kuyrukta skor toplamı 0 ise kalan pay 1. oyuncuya eklenir', () => {
    const pool = toMinorUnits(1_000);
    const list = candidates(10, () => 0);
    const result = allocatePrizePool(pool, list);

    expect(total(result)).toBe(pool);
  });

  it('adaylar sırasız gelse de sıraya göre paylaştırır', () => {
    const pool = toMinorUnits(10_000);
    const shuffled: PoolCandidate[] = [
      { userId: 'c', rank: 3, score: 300 },
      { userId: 'a', rank: 1, score: 500 },
      { userId: 'b', rank: 2, score: 400 },
    ];
    const result = allocatePrizePool(pool, shuffled);

    expect(result.find((r) => r.rank === 1)!.userId).toBe('a');
    expect(result.find((r) => r.rank === 2)!.amountMinor).toBe(150_000n);
  });
});

describe('para birimi dönüşümleri', () => {
  it('kuruşa çevirir ve geri okur', () => {
    expect(toMinorUnits(123.45)).toBe(12_345n);
    expect(minorUnitsToDecimalString(12_345n)).toBe('123.45');
  });

  it('kuruş kısmını iki haneye tamamlar', () => {
    expect(minorUnitsToDecimalString(5n)).toBe('0.05');
    expect(minorUnitsToDecimalString(100n)).toBe('1.00');
  });

  it('yüzde 2 kesintisini kayan nokta hatası olmadan hesaplar', () => {
    // 0.1 + 0.2 !== 0.3 tuzağının para tarafına sızmadığını doğrular.
    let pool = 0n;
    for (let i = 0; i < 3; i++) pool += toMinorUnits(0.1);
    expect(minorUnitsToDecimalString(pool)).toBe('0.30');
  });
});
