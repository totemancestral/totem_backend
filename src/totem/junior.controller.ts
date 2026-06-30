import { Body, Controller, Post } from '@nestjs/common';
import { JuniorService } from './junior.service';

@Controller('junior')
export class JuniorController {
  constructor(private readonly junior: JuniorService) {}

  @Post()
  reveal(@Body() body: unknown) {
    return this.junior.reveal(body);
  }
}
