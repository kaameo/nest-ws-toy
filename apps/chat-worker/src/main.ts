import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { KAFKA_CLIENT_ID, KAFKA_CONSUMER_GROUPS } from '@app/common';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const brokers = configService.getOrThrow<string>('KAFKA_BROKERS').split(',');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: `${KAFKA_CLIENT_ID}-worker`,
        brokers,
      },
      consumer: {
        groupId: KAFKA_CONSUMER_GROUPS.PERSISTOR,
        allowAutoTopicCreation: true,
      },
    },
  });

  await app.startAllMicroservices();

  const logger = new Logger('ChatWorker');
  const port = configService.get<number>('WORKER_PORT', 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`Chat Worker listening on port ${port}, Kafka consumer started`);
}
bootstrap();
