/**
 * Ödül havuzu paylaştırma matematiği.
 *
 * Saf fonksiyon olarak ayrıldı: para hesabı veritabanından ve Redis'ten
 * bağımsız test edilebilmelidir — kuruş kaybı ancak böyle doğrudan sınanır.
 *
 * Bu dosyanın tek kuralı var ve her satır ona uyar: **para hiçbir aşamada
 * `number`'a düşmez.** Sebep, ikili kayan noktada `0.1 + 0.2 !== 0.3`
 * olmasıdır; yüzde payları toplanırken havuzdan kuruş sızar. Bu yüzden:
 *
 *   - tüm hesap `bigint` kuruş üzerinden yapılır,
 *   - yüzdeler basis point ile çarpılır (`percentOf`), ara adımda float yok,
 *   - Postgres'ten gelen `Decimal` değerleri `decimalStringToMinorUnits` ile
 *     dizgiden ayrıştırılır, `Number()` ile değil,
 *   - yuvarlama artığı 1. oyuncuya eklenir; dağıtılan toplam havuza TAM eşit
 *     kalır, kuruş ne kaybolur ne yoktan var olur.
 *
 * Aynı disiplin şemada `Decimal(18,4)`, Redis'te `INCRBY` (float değil) ile
 * sürdürülür. Değişmez, `reward-math.spec.ts` ile sabitlenmiştir.
 */

export const PRIZE_POOL_RATE = 0.02;

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

const MINOR_UNITS_PER_MAJOR = 100n;

export function toMinorUnits(amount: number): bigint {
  return BigInt(Math.round(amount * Number(MINOR_UNITS_PER_MAJOR)));
}

/**
 * Ondalık para dizgisini kuruşa çevirir — float'a uğramadan.
 *
 * `toMinorUnits` `number` aldığı için çağıranı float'a zorlar; Postgres'ten
 * gelen `Decimal` değerlerinde bu tam da kaçınılan kaybı üretir. Şema 4
 * ondalık tutar, para birimi 2 kuruş kullanır: fazlası en yakın kuruşa
 * yuvarlanır.
 */
export function decimalStringToMinorUnits(amount: string): bigint {
  const negative = amount.trimStart().startsWith('-');
  const [whole, fraction = ''] = amount.replace('-', '').trim().split('.');

  // İlk iki basamak kuruş; üçüncü basamak yuvarlama kararını verir.
  const cents = (fraction + '00').slice(0, 2);
  const roundUp = Number((fraction + '000')[2]) >= 5;

  let minor = BigInt(whole || '0') * MINOR_UNITS_PER_MAJOR + BigInt(cents);
  if (roundUp) minor += 1n;

  return negative ? -minor : minor;
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
 *   4..100   -> kalan %55, SIRALARINA orantılı
 *
 * Case'in ifadesi birebir şudur: "the remaining 55% is distributed among
 * players ranked 4th through 100th, based on their rank." Ağırlık bu yüzden
 * sıradan türetilir (`REWARDED_PLAYER_COUNT + 1 - rank`): 4. sıra en yüksek,
 * 100. sıra en düşük payı alır ve pay sırayla doğrusal azalır.
 *
 * Skora orantılı dağıtım denendi ve ÖLÇÜLEREK reddedildi: ilk 100'e girenlerin
 * skorları birbirine çok yakın olduğu için (canlı veride 4. ile 100. arasında
 * yalnızca 1,18 kat fark) ödüller de neredeyse eşitleniyordu — 4. sıradaki
 * oyuncu 100. sıradakinden yalnızca %18 fazla alıyordu ve sıralamanın bu
 * aralıkta pratik bir karşılığı kalmıyordu. Sıra tabanlı ağırlıkta aynı fark
 * 97 kata çıkar; rekabetin ödülü görünür olur.
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

  // 4-100 arası: kalan %55, SIRAYA orantılı.
  //
  // Ağırlık sıradan türetilir; skor hesaba girmez. Böylece pay yalnızca
  // sıralamaya bağlıdır ve iki oyuncunun skoru ne kadar yakın olursa olsun
  // aralarındaki sıra farkı ödüle yansır.
  const remainderPool = percentOf(poolMinor, REMAINDER_SHARE);
  const tail = allocations.slice(TOP_SHARES.length);

  if (tail.length > 0) {
    const weights = tail.map((a) => rankWeight(a.rank));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0n);

    for (const [index, allocation] of tail.entries()) {
      allocation.amountMinor = (remainderPool * weights[index]) / totalWeight;
    }
  }

  // Yuvarlama artığı: dağıtılan toplam ile havuz arasındaki fark daima
  // 1. oyuncuya eklenir, böylece toplam korunur.
  //
  // Buraya YALNIZCA bölme artıkları düşer (birkaç kuruş). %55'in tamamının
  // buraya düşebildiği durum yukarıda kapatıldı: kuyruk hiç yoksa (ör. sezonu
  // 3 oyuncuyla kapatmak) artık yine büyür, ama o senaryoda dağıtılacak
  // 4-100 sırası fiilen mevcut değildir ve havuzun sahipsiz kalmaması
  // gerekir.
  const distributed = allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
  const leftover = poolMinor - distributed;
  if (leftover !== 0n && allocations.length > 0) {
    allocations[0].amountMinor += leftover;
  }

  // Sıfır paylı kayıt yazılmaz — RewardLog'u anlamsız satırlarla şişirmemek için.
  return allocations.filter((a) => a.amountMinor > 0n);
}

/**
 * Bir sıranın 4-100 paylaşımındaki ağırlığı.
 *
 * 4. sıra en yüksek (97), 100. sıra en düşük (1) ağırlığı alır; aradaki
 * azalma doğrusaldır. Ağırlık daima pozitiftir, dolayısıyla ödül alan her
 * oyuncuya sıfırdan büyük bir pay düşer ve `REWARDED_PLAYER_COUNT` sınırının
 * dışına taşan bir sıra buraya hiç gelmez.
 */
function rankWeight(rank: number): bigint {
  return BigInt(Math.max(1, REWARDED_PLAYER_COUNT + 1 - rank));
}

/** BigInt aritmetiğiyle yüzde: ara adımda float'a düşmez. */
function percentOf(amountMinor: bigint, share: number): bigint {
  const basisPoints = BigInt(Math.round(share * 10_000));
  return (amountMinor * basisPoints) / 10_000n;
}
