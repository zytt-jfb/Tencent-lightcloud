import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseCorsOrigins } from './runtime.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  console.log('API_SHUTDOWN_HOOKS_ENABLED');

  // 安全响应头：Helmet 必须在 CORS 和路由之前注册
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  express.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const allowedOrigins = process.env.CORS_ORIGINS
    ? parseCorsOrigins(process.env.CORS_ORIGINS)
    : ['http://localhost:3001', 'http://localhost:5173'];
  app.enableCors({ origin: allowedOrigins, credentials: true });

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('经营单元上报系统 API')
      .setDescription('Admin Console 后端接口文档')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`API_LISTENING port=${port}`);
  if (process.env.NODE_ENV !== 'production') console.log('SWAGGER_READY path=/api/docs');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_BOOTSTRAP_ERROR';
  console.error(`API_BOOTSTRAP_FAILED message=${message}`);
  process.exitCode = 1;
});

