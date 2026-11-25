import { type DynamicModule, Module } from "@nestjs/common";

import {
  defaultSafeHttpOptions,
  SAFE_HTTP_OPTIONS,
  SafeHttpClient,
  type SafeHttpOptions,
} from "./safe-http.js";

/** Outbound HTTP to customer-supplied URLs, with SSRF protection. */
@Module({})
export class NetModule {
  static forRoot(
    options: SafeHttpOptions = defaultSafeHttpOptions,
  ): DynamicModule {
    return {
      module: NetModule,
      global: true,
      providers: [
        { provide: SAFE_HTTP_OPTIONS, useValue: options },
        {
          provide: SafeHttpClient,
          inject: [SAFE_HTTP_OPTIONS],
          useFactory: (resolved: SafeHttpOptions) =>
            new SafeHttpClient(resolved),
        },
      ],
      exports: [SafeHttpClient],
    };
  }
}
