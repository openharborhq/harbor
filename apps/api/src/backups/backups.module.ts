import { Module } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module";
import { BackupsController } from "./backups.controller";
import { BackupsService } from "./backups.service";

/** `backup_runs` for Settings, and the runs themselves for the `backup` container (spec §3.4). */
@Module({
  imports: [CryptoModule],
  controllers: [BackupsController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class BackupsModule {}
