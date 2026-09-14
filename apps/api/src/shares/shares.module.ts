import { Module } from "@nestjs/common";
import { SharesController } from "./shares.controller";
import { SharesService } from "./shares.service";
import { DoormanSink } from "./share-sink";

/**
 * Sharing (spec §10). Not global: nothing else in the API creates a share, and keeping the seal
 * reachable from exactly one place is part of why it is safe.
 */
@Module({
  controllers: [SharesController],
  providers: [SharesService, DoormanSink],
  exports: [SharesService],
})
export class SharesModule {}
