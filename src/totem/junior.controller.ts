import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { JuniorService } from './junior.service';

@Controller('junior')
export class JuniorController {
  constructor(private readonly junior: JuniorService) {}

  @Post('reveal')
  reveal(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    return this.junior.reveal(body, authorization);
  }

  @Get('totems')
  listTotems(@Headers('authorization') authorization: string) {
    return this.junior.listTotems(authorization);
  }

  @Post('share/:id')
  shareTotem(
    @Param('id') id: string,
    @Headers('authorization') authorization: string,
  ) {
    return this.junior.shareTotem(id, authorization);
  }
}