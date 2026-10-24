import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { RulesModule } from '../rules/rules.module';
import { VisitsGuardController, VisitsManagementController } from './visits.controller';
import { VisitsService } from './visits.service';
import { VehicleRegistryService } from './vehicle-registry.service';
import { VEHICLE_LOOKUP_QUEUE, VehicleLookupJobs, VehicleLookupProcessor } from './vehicle-lookup.jobs';

@Module({ imports: [DatabaseModule,RulesModule,BullModule.registerQueue({name:VEHICLE_LOOKUP_QUEUE})], controllers: [VisitsGuardController,VisitsManagementController],
  providers: [VisitsService,VehicleRegistryService,VehicleLookupJobs,VehicleLookupProcessor], exports: [VisitsService] })
export class VisitsModule {}
