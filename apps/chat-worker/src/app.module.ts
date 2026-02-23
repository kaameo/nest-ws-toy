import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from '@app/common';
import { DbModule } from '@app/db';
import { PersistorModule } from './persistor/persistor.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    DbModule,
    PersistorModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
