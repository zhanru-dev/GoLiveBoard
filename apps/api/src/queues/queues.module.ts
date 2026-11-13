import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { JobPublisher } from "./job-publisher.js";
import {
  closeWithin,
  DEFAULT_JOB_OPTIONS,
  producerConnection,
  QUEUE_NAMES,
  type QueueName,
} from "./queues.js";

/** Injection token for the map of queue name to BullMQ queue. */
export const QUEUES = Symbol("QUEUES");

/** BullMQ queues on Valkey, used by the worker. */
@Module({
  providers: [
    {
      provide: QUEUES,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ReadonlyMap<QueueName, Queue> =>
        new Map(
          QUEUE_NAMES.map((name) => [
            name,
            new Queue(name, {
              connection: producerConnection(config),
              prefix: config.queues.prefix,
              defaultJobOptions: DEFAULT_JOB_OPTIONS,
            }),
          ]),
        ),
    },
    {
      provide: JobPublisher,
      inject: [QUEUES],
      useFactory: (queues: ReadonlyMap<QueueName, Queue>) =>
        new JobPublisher(queues),
    },
  ],
  exports: [QUEUES, JobPublisher],
})
export class QueuesModule implements OnApplicationShutdown {
  constructor(
    @Inject(QUEUES) private readonly queues: ReadonlyMap<QueueName, Queue>,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.queues.values()].map((queue) =>
        closeWithin(
          () => queue.close(),
          () => queue.disconnect(),
        ),
      ),
    );
  }
}
