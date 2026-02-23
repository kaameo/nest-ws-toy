import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { KAFKA_CLIENT_ID, KAFKA_CONSUMER_GROUPS } from '@app/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const brokers = configService.getOrThrow<string>('KAFKA_BROKERS').split(',');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: `${KAFKA_CLIENT_ID}-gateway`,
        brokers,
      },
      consumer: {
        groupId: KAFKA_CONSUMER_GROUPS.BROADCAST,
      },
    },
  });

  await app.startAllMicroservices();

  const logger = new Logger('ChatGateway');
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Chat Gateway listening on port ${port}, Kafka consumer started`);
}
bootstrap();
