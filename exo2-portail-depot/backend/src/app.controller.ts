import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * The Nest scaffold's route, kept for now as a sign of life on the API root.
   * @Public() because the guard closed every route when it became global -- it
   * carries no data, so opening it costs nothing. It should disappear the day a
   * real root route exists.
   */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
