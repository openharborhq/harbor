import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { Public } from "../auth/public.decorator";

@Controller("health")
export class HealthController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Public on purpose: "what is this box running" is the first question of every upgrade that
   * went wrong, and it should be answerable without signing in. It says the version and nothing
   * else about the vault.
   */
  @Public()
  @Get()
  get() {
    return {
      ok: true,
      service: "api",
      version: this.config.get("HARBOR_VERSION", { infer: true }),
      commit: this.config.get("HARBOR_COMMIT", { infer: true }),
      time: new Date().toISOString(),
    };
  }
}
