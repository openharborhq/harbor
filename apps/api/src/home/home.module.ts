import { Module } from "@nestjs/common";
import { BackupsModule } from "../backups/backups.module";
import { HomeController } from "./home.controller";
import { HomeService } from "./home.service";

@Module({ imports: [BackupsModule], controllers: [HomeController], providers: [HomeService] })
export class HomeModule {}
