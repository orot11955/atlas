import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthService, type ReadyResult } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness check' })
  public live(): { status: 'up'; timestamp: string } {
    return {
      status: 'up',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness check' })
  public ready(): Promise<ReadyResult> {
    return this.healthService.ready();
  }
}
