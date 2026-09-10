import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  CloseTask,
  CreateTask,
  ListTasksQuery,
  UpdateTask,
  type SessionUser,
  type Task,
  type TaskCount,
} from "@harbor/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodPipe } from "../common/zod.pipe";
import { TasksService } from "./tasks.service";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Query(new ZodPipe(ListTasksQuery)) query: ListTasksQuery): Promise<Task[]> {
    return this.tasks.list(query);
  }

  /** Declared before `:id` so "count" is never parsed as a uuid. */
  @Get("count")
  count(): Promise<TaskCount> {
    return this.tasks.count();
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<Task> {
    return this.tasks.get(id);
  }

  @Post()
  create(@Body(new ZodPipe(CreateTask)) body: CreateTask, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<Task> {
    return this.tasks.create(body, user.id, req.ip ?? null);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateTask)) body: UpdateTask,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<Task> {
    return this.tasks.update(id, body, user.id, req.ip ?? null);
  }

  /**
   * Done or dismissed. The response carries `next` because completing a repeating task creates
   * its successor, and a list that did not learn about it immediately would look like the series
   * had ended.
   */
  @Post(":id/close")
  close(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(CloseTask)) body: CloseTask,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<{ task: Task; next: Task | null }> {
    return this.tasks.close(id, body, user.id, req.ip ?? null);
  }

  @Post(":id/reopen")
  reopen(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<Task> {
    return this.tasks.reopen(id, user.id, req.ip ?? null);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<void> {
    await this.tasks.remove(id, user.id, req.ip ?? null);
  }
}
