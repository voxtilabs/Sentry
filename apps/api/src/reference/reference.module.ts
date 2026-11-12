import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { GeoModule } from '../geo/geo.module';
import { RulesModule } from '../rules/rules.module';
import { SupervisorModule } from '../supervisor/supervisor.module';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';
@Module({ imports:[DatabaseModule,GeoModule,RulesModule,SupervisorModule],controllers:[ReferenceController],providers:[ReferenceService] })
export class ReferenceModule {}
