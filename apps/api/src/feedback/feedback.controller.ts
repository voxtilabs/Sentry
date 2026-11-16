import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { SkipTenantContext } from '../database/tenant-context/skip-tenant-context.decorator';
import { FeedbackDto } from './feedback.dto';
import { FeedbackService } from './feedback.service';

/** Canal de la plataforma: no lee ni admite IDs de empresa, usuario o recinto. */
@Controller('feedback')
@SkipTenantContext()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(202)
  @Public()
  submit(@Body() input: FeedbackDto, @Req() request: Request) {
    return this.feedback.submit(input, request.ip ?? 'unknown');
  }
}
