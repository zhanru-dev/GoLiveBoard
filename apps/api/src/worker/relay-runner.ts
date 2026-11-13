import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { OutboxRelay } from "../outbox/outbox-relay.js";
import { WORKER_OPTIONS, type WorkerOptions } from "./worker-options.js";

/** Runs the outbox relay for as long as the worker process runs. */
@Injectable()
export class RelayRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly relay: OutboxRelay,
    @Inject(WORKER_OPTIONS) private readonly options: WorkerOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.consume) {
      this.relay.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay.stop();
  }
}
