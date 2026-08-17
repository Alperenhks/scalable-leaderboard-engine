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

  // Tarayıcıdan gelen istekler için CORS: yerel geliştirme ortamı ve
  // Vercel'in ürettiği tüm canlı/preview alan adları kabul edilir.
  app.enableCors({
    origin: [
      'http://localhost:3000', // Senin bilgisayarındaki test ortamı
      /^https:\/\/.*\.vercel\.app$/, // Vercel'in üreteceği TÜM canlı ve test linkleri
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
