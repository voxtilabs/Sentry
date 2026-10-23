import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RulesModule } from '../rules/rules.module';
import { VisitsGuardController, VisitsManagementController } from './visits.controller';
import { VisitsService } from './visits.service';
import { VehicleRegistryService } from './vehicle-registry.service';

@Module({ imports: [DatabaseModule,RulesModule], controllers: [VisitsGuardController,VisitsManagementController],
  providers: [VisitsService,VehicleRegistryService], exports: [VisitsService] })
export class VisitsModule {}
