import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { PlatformController } from './platform.controller';
import { CompanyGroupsController } from './company-groups.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [DatabaseModule, MailModule],
  controllers: [PlatformController, CompanyGroupsController],
  providers: [PlatformService],
})
export class PlatformModule {}
