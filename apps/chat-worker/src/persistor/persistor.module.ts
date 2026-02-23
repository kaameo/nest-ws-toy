import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message, Room } from '@app/db';
import { PersistorController } from './persistor.controller';
import { PersistorService } from './persistor.service';
import { FanoutModule } from '../fanout/fanout.module';

@Module({
  imports: [TypeOrmModule.forFeature([Message, Room]), FanoutModule],
  controllers: [PersistorController],
  providers: [PersistorService],
  exports: [PersistorService],
})
export class PersistorModule {}
