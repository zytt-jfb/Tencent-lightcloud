import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity } from './message.entity';
import { ReminderLogEntity } from './reminder-log.entity';
import { UserEntity } from '../users/user.entity';
import { CityEntity } from '../cities/city.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { AdminRemindersController } from './reminders.controller';
import { MessagesController } from './messages.controller';
import { RemindersService } from './reminders.service';
import { ReminderScheduler } from './reminder.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageEntity, ReminderLogEntity, UserEntity, CityEntity, AnnualPackageEntity, MonthSnapshotEntity]),
  ],
  controllers: [AdminRemindersController, MessagesController],
  providers: [RemindersService, ReminderScheduler],
  exports: [RemindersService],
})
export class RemindersModule {}
