import { Global, Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

/**
 * Global because two other modules need to create tasks without importing the HTTP surface:
 * DocumentsModule turns an accepted suggestion into one, and HomeModule reads them for the
 * "Needs attention" panel.
 */
@Global()
@Module({
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
