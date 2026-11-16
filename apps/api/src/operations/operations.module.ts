import { GuardQuotaService } from './guard-quota.service';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RulesModule } from '../rules/rules.module';
import { AuditWriterModule } from '../audit/audit-writer.module';
import { OperationsService } from './operations.service';
import { GuardPersonalService } from './guard-personal.service';
import { OperationsController } from './operations.controller';
@Module({imports:[DatabaseModule,RulesModule,AuditWriterModule],providers:[GuardQuotaService,OperationsService,GuardPersonalService],controllers:[OperationsController],exports:[GuardPersonalService,GuardQuotaService,OperationsService]})
export class OperationsModule{}
