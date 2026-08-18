import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  // Express yerine Fastify: 2M DAU hedefinde istek başına daha düşük
  // overhead ve belirgin biçimde yüksek throughput sağlar.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );

  // Tarayıcıdan gelen istekler için CORS.
  //
  // Origin listesi `ALLOWED_ORIGINS` ortam değişkeninden okunur (virgülle
  // ayrılmış). Tanımlıysa YALNIZCA o adresler kabul edilir — üretimde
  // yapılması gereken budur.
  //
  // Tanımlı değilse geliştirme/demo varsayılanına düşülür: yerel portlar ve
  // Vercel'in ürettiği tüm preview alan adları. Bu genişlik bilinçlidir çünkü
  // Vercel her dağıtım için yeni bir alan adı üretir ve hepsini elle listelemek
  // pratik değildir; ancak `credentials: true` ile birlikte herhangi bir
  // `*.vercel.app` sitesinin kimlik taşıyan istek atabileceği anlamına gelir.
  // Gerçek bir dağıtımda `ALLOWED_ORIGINS` mutlaka verilmelidir.
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins?.length
      ? allowedOrigins
      : [
          'http://localhost:3000', // Next.js varsayılan portu
          'http://localhost:5173', // Vite varsayılan portu
          /^http:\/\/127\.0\.0\.1:(3000|5173)$/, // Bazı tarayıcılar localhost'u böyle çözer
          /^https:\/\/.*\.vercel\.app$/, // Vercel'in preview/canlı adresleri
        ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Tüm iş uçları /api altında toplanır. Kök yol hariç tutulur: konteyner
  // sağlık probu ve mevcut e2e testi GET / bekliyor.
  app.setGlobalPrefix('api', { exclude: ['/'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 8080);

  // Konteyner içinde dışarıdan erişilebilmesi için 0.0.0.0'a bind edilir.
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
