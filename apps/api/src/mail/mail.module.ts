import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { AutodiscoverService } from "./autodiscover.service";
import { MailBackfillService } from "./mail-backfill.service";
import { MailConnectionsService } from "./mail-connections.service";
import { MailFetcherService } from "./mail-fetcher.service";
import { MailSendersService } from "./mail-senders.service";
import { MailController } from "./mail.controller";

/**
 * Connections, rules, and the passes that act on them (spec §7). The API imports this for the
 * settings and review screens; only `mailfetch` ever runs the fetcher or the backfill, because it
 * is the one process with a route to an IMAP host (§3.6).
 */
@Module({
  imports: [DocumentsModule],
  controllers: [MailController],
  providers: [MailConnectionsService, MailSendersService, MailBackfillService, MailFetcherService, AutodiscoverService],
  exports: [MailConnectionsService, MailSendersService, MailBackfillService, MailFetcherService, AutodiscoverService],
})
export class MailModule {}
