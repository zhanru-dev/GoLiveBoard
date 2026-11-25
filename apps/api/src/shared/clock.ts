import { type DynamicModule, Module } from "@nestjs/common";

/**
 * The current time, injected rather than read with `new Date()`, so tests can
 * fix it and expiry rules can be tested without waiting
 * (docs/05-engineering-standards.md, "Time and randomness are injected").
 */
export interface Clock {
  now(): Date;
}

/** Injection token for the clock. */
export const CLOCK = Symbol("CLOCK");

export const systemClock: Clock = { now: () => new Date() };

@Module({})
export class ClockModule {
  static forRoot(clock: Clock = systemClock): DynamicModule {
    return {
      module: ClockModule,
      global: true,
      providers: [{ provide: CLOCK, useValue: clock }],
      exports: [CLOCK],
    };
  }
}
