import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod/v4";

/** Validate a request body/query against a Zod (v4) schema from @harbor/shared. */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
      });
    }
    return result.data;
  }
}
