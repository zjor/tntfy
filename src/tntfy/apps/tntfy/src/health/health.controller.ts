import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  health() {
    return { status: 'ok' };
  }
}
