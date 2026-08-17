import { getCurrentSeasonId, SEASON_ID_REGEX } from './season.util';

describe('getCurrentSeasonId', () => {
  it('hafta ortası bir tarihi doğru sezona eşler', () => {
    // 18 Ağustos 2026, Salı
    expect(getCurrentSeasonId(new Date('2026-08-18T12:00:00Z'))).toBe(
      '2026-W34',
    );
  });

  it('hafta numarasını iki haneye tamamlar', () => {
    expect(getCurrentSeasonId(new Date('2026-01-08T00:00:00Z'))).toBe(
      '2026-W02',
    );
  });

  /**
   * ISO-8601'in asıl inceliği: yıl, haftanın Perşembe'sinden okunur. 1 Ocak
   * 2027 bir Cuma olduğu için o hafta hâlâ 2026'nın son haftasıdır.
   */
  it('yıl sınırında takvim yılını değil ISO yılını kullanır', () => {
    expect(getCurrentSeasonId(new Date('2027-01-01T00:00:00Z'))).toBe(
      '2026-W53',
    );
  });

  it('yılın ilk Perşembesini içeren haftayı W01 sayar', () => {
    // 4 Ocak 2027 Pazartesi; o haftanın Perşembesi 7 Ocak 2027.
    expect(getCurrentSeasonId(new Date('2027-01-04T00:00:00Z'))).toBe(
      '2027-W01',
    );
  });

  it('UTC üzerinden hesaplar — yerel saat diliminden etkilenmez', () => {
    // Aynı an, farklı ofsetlerle yazılmış iki tarih aynı sezonu vermeli.
    const a = getCurrentSeasonId(new Date('2026-08-18T23:30:00Z'));
    const b = getCurrentSeasonId(new Date('2026-08-19T02:30:00+03:00'));
    expect(a).toBe(b);
  });

  it('ürettiği her değer SEASON_ID_REGEX ile doğrulanabilir', () => {
    for (let day = 0; day < 365; day += 7) {
      const d = new Date(Date.UTC(2026, 0, 1 + day));
      expect(getCurrentSeasonId(d)).toMatch(SEASON_ID_REGEX);
    }
  });
});

describe('SEASON_ID_REGEX', () => {
  it('geçerli biçimleri kabul eder', () => {
    expect('2026-W01').toMatch(SEASON_ID_REGEX);
    expect('2026-W53').toMatch(SEASON_ID_REGEX);
  });

  it('sınır dışı ve bozuk biçimleri reddeder', () => {
    expect('2026-W00').not.toMatch(SEASON_ID_REGEX);
    expect('2026-W54').not.toMatch(SEASON_ID_REGEX);
    expect('2026-W1').not.toMatch(SEASON_ID_REGEX);
    expect('26-W01').not.toMatch(SEASON_ID_REGEX);
    expect('2026W01').not.toMatch(SEASON_ID_REGEX);
  });
});
