import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DashboardController],
  providers: [DashboardService, PortfolioService],
})
export class DashboardModule {}
