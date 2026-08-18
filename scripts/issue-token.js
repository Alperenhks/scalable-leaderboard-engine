/**
 * Geliştirme amaçlı JWT üretir.
 *
 *   node scripts/issue-token.js <userId> [username]
 *
 * Gerçek bir login akışı henüz yok; bu script korumalı uçları denemek için
 * .env'deki JWT_SECRET ile imzalanmış geçerli bir token verir.
 *
 * Bağımlılık eklememek için jsonwebtoken yerine Node'un yerleşik crypto'su
 * kullanılır — üretilen token @nestjs/jwt tarafından birebir doğrulanır.
 */
require('dotenv/config');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));

const [userId, username] = positional;

if (!userId) {
  console.error(
    'Kullanım: node scripts/issue-token.js <userId> [username]',
  );
  process.exit(1);
}

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('.env içinde JWT_SECRET tanımlı değil');
  process.exit(1);
}

const base64url = (input) => Buffer.from(input).toString('base64url');

const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

const now = Math.floor(Date.now() / 1000);
const payload = base64url(
  JSON.stringify({
    sub: userId,
    ...(username ? { username } : {}),
    roles: ['player'],
    iat: now,
    exp: now + 7 * 24 * 60 * 60, // AuthModule ile aynı: 7 gün
  }),
);

const signature = crypto
  .createHmac('sha256', secret)
  .update(`${header}.${payload}`)
  .digest('base64url');

console.log(`${header}.${payload}.${signature}`);
