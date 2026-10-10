import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { AccountSecurityService } from './account-security.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, CityEntity, OperationLogEntity])],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, AccountSecurityService],
  exports: [UsersService, AccountSecurityService],
})
export class UsersModule {}
