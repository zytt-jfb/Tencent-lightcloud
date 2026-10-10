import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '../rbac/rbac.module';
import { CityEntity } from '../main-data/city.entity';
import { BizMessageEntity } from '../reminders/biz-message.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizAnnouncementEntity } from './biz-announcement.entity';
import { BizAnnouncementReadEntity } from './biz-announcement-read.entity';
import { BizCommunicationService } from './biz-communication.service';
import { BizMessageController } from './biz-message.controller';
import { BizAnnouncementController } from './biz-announcement.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BizAnnouncementEntity, BizAnnouncementReadEntity, BizMessageEntity, BizOperationLogEntity, CityEntity]), RbacModule],
  controllers: [BizMessageController, BizAnnouncementController],
  providers: [BizCommunicationService],
})
export class BizCommunicationsModule {}
