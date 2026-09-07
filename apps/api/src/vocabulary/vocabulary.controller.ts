import { Body, Controller, Get, Post } from "@nestjs/common";
import { CreateCategory, CreatePerson, type Category, type Person, type SessionUser } from "@trustworthier/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodPipe } from "../common/zod.pipe";
import { CategoriesService } from "./categories.service";
import { PeopleService } from "./people.service";

@Controller()
export class VocabularyController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly people: PeopleService,
  ) {}

  @Get("categories")
  listCategories(): Promise<Category[]> {
    return this.categories.list();
  }

  @Post("categories")
  createCategory(@Body(new ZodPipe(CreateCategory)) body: CreateCategory, @CurrentUser() user: SessionUser): Promise<Category> {
    return this.categories.create(body, user.id);
  }

  @Get("people")
  listPeople(): Promise<Person[]> {
    return this.people.list();
  }

  @Post("people")
  createPerson(@Body(new ZodPipe(CreatePerson)) body: CreatePerson, @CurrentUser() user: SessionUser): Promise<Person> {
    return this.people.create(body, user.id);
  }
}
