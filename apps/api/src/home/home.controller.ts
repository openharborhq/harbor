import { Controller, Get } from "@nestjs/common";
import type { HomeData } from "@trustworthier/shared";
import { HomeService } from "./home.service";

@Controller("home")
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  load(): Promise<HomeData> {
    return this.home.load();
  }
}
