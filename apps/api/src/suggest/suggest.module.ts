import { Global, Module, type DynamicModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NoneProvider } from "./none.provider";
import { SUGGESTION_PROVIDER, SuggestService, buildProvider } from "./suggest.service";

/**
 * `withProvider: true` only in the suggester process — it is the one place that holds the API key
 * and talks to the model. The API imports the module for reading/resolving stored suggestions
 * and gets an inert provider, so it never needs the key and never has a reason to reach out.
 */
@Global()
@Module({})
export class SuggestModule {
  static register(opts: { withProvider: boolean }): DynamicModule {
    return {
      module: SuggestModule,
      providers: [
        opts.withProvider
          ? { provide: SUGGESTION_PROVIDER, inject: [ConfigService], useFactory: buildProvider }
          : { provide: SUGGESTION_PROVIDER, useValue: new NoneProvider() },
        SuggestService,
      ],
      exports: [SuggestService, SUGGESTION_PROVIDER],
    };
  }
}
