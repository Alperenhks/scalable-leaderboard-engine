/**
 * Ödül havuzu paylaştırma matematiği.
 *
 * Saf fonksiyon olarak ayrıldı: para hesabı, veritabanı ve Redis'ten bağımsız
 * olarak test edilebilmelidir. Kuruş kaybı/kazancı gibi hatalar ancak burada
 * doğrudan sınanabilir.
 */

/** Skor akışının havuza aktarılan oranı. */
export const PRIZE_POOL_RATE = 0.02;

/** Ödül alan oyuncu sayısı üst sınırı. */
export const REWARDED_PLAYER_COUNT = 100;

/** İlk üç sıranın sabit payları; kalan %55 4-100 arasına dağıtılır. */
export const TOP_SHARES = [0.2, 0.15, 0.1] as const;
export const REMAINDER_SHARE = 0.55;

export interface PoolCandidate {
  userId: string;
  rank: number;
  score: number;
}

export interface RewardAllocation {
  userId: string;
  rank: number;
  score: number;
  /** Kuruş cinsinden tamsayı — kayan nokta hatası taşımaz. */
  amountMinor: bigint;
}

/**
 * Para hesabı tamsayı (kuruş) üzerinden yapılır.
 *
 * Gerekçe: 0.1 + 0.2 !== 0.3 olduğu için ikili kayan noktada yüzde payları
 * toplandığında havuzdan kuruş sızar. Şemada Decimal(18,4) kullanılmasının
 * sebebi de aynıdır. Burada da aynı disiplin korunur.
 */
const MINOR_UNITS_PER_MAJOR = 100n;

export function toMinorUnits(amount: number): bigint {
  return BigInt(Math.round(amount * Number(MINOR_UNITS_PER_MAJOR)));
}

export function minorUnitsToDecimalString(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const major = abs / MINOR_UNITS_PER_MAJOR;
  const rest = abs % MINOR_UNITS_PER_MAJOR;
  return `${negative ? '-' : ''}${major}.${rest.toString().padStart(2, '0')}`;
}

/**
 * Havuzu sıralamaya göre paylaştırır.
 *
 * Dağıtım kuralı:
 *   1.       -> %20
 *   2.       -> %15
 *   3.       -> %10
 *   4..100   -> kalan %55, skorlarıyla ORANTILI
 *
 * 4-100 aralığında skora oranlı dağıtım seçildi (eşit bölüşüm değil): 4. ile
 * 100. oyuncunun katkısı arasında büyük fark olabilir ve eşit pay, sıralamanın
 * anlamını bu aralıkta tamamen silerdi.
 *
 * Yuvarlama artığı 1. oyuncuya eklenir; böylece dağıtılan toplam havuza tam
 * eşit olur ve kuruş ne kaybolur ne de yoktan var edilir.
 */
export function allocatePrizePool(
  poolMinor: bigint,
  candidates: PoolCandidate[],
): RewardAllocation[] {
  if (poolMinor <= 0n || candidates.length === 0) return [];

  const winners = candidates
    .slice(0, REWARDED_PLAYER_COUNT)
    .sort((a, b) => a.rank - b.rank);

  const allocations: RewardAllocation[] = winners.map((c) => ({
    userId: c.userId,
    rank: c.rank,
    score: c.score,
    amountMinor: 0n,
  }));

  // İlk üç sabit pay. Sıra boşsa (ör. yalnızca 2 oyuncu var) o payı
  // dağıtılmamış bırakmayız — artık hesabı sonunda 1.'ye eklenir.
  TOP_SHARES.forEach((share, index) => {
    if (index < allocations.length) {
      allocations[index].amountMinor = percentOf(poolMinor, share);
    }
  });

  // 4-100 arası: kalan %55, skorla orantılı.
  const remainderPool = percentOf(poolMinor, REMAINDER_SHARE);
  const tail = allocations.slice(TOP_SHARES.length);
  const totalTailScore = tail.reduce(
    (sum, a) => sum + BigInt(Math.max(0, a.score)),
    0n,
  );

  if (tail.length > 0 && totalTailScore > 0n) {
    for (const allocation of tail) {
      const weight = BigInt(Math.max(0, allocation.score));
      allocation.amountMinor = (remainderPool * weight) / totalTailScore;
    }
  }

  // Yuvarlama artığı: dağıtılan toplam ile havuz arasındaki fark daima
  // 1. oyuncuya eklenir, böylece toplam korunur.
  const distributed = allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
  const leftover = poolMinor - distributed;
  if (leftover !== 0n && allocations.length > 0) {
    allocations[0].amountMinor += leftover;
  }

  // Sıfır paylı kayıt yazılmaz — RewardLog'u anlamsız satırlarla şişirmemek için.
  return allocations.filter((a) => a.amountMinor > 0n);
}

/** BigInt aritmetiğiyle yüzde: ara adımda float'a düşmez. */
function percentOf(amountMinor: bigint, share: number): bigint {
  const basisPoints = BigInt(Math.round(share * 10_000));
  return (amountMinor * basisPoints) / 10_000n;
}
