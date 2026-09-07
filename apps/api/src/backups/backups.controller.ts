import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { Queue } from "bullmq";
import { RunBackup, type BackupRun, type BackupStatus } from "@harbor/shared";
import { ZodPipe } from "../common/zod.pipe";
import { InjectBackupOpsQueue, type BackupOpsJob } from "../queue/queue.module";
import { BackupsService } from "./backups.service";

/**
 * Settings → Backups (spec §3.4, §4). Reads `backup_runs`; the two buttons enqueue for the
 * `backup` container, which is the only process with restic and a route to the repository.
 */
@Controller("backups")
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    @InjectBackupOpsQueue() private readonly ops: Queue<BackupOpsJob>,
  ) {}

  @Get()
  status(): Promise<BackupStatus> {
    return this.backups.status();
  }

  @Get("runs")
  runs(): Promise<BackupRun[]> {
    return this.backups.list(20);
  }

  @Post("run")
  @HttpCode(202)
  async run(@Body(new ZodPipe(RunBackup)) body: RunBackup): Promise<{ queued: true }> {
    const status = await this.backups.status();
    if (!status.configured) throw new BadRequestException("No backup repository is configured — set RESTIC_REPOSITORY on the appliance first.");
    if (status.running) throw new ConflictException(`A ${status.running.kind === "backup" ? "backup" : "restore test"} is already running.`);
    await this.ops.add(body.kind, { kind: body.kind });
    return { queued: true };
  }
}
