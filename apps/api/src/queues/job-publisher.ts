import type { JobsOptions, Queue } from "bullmq";

import type { QueueName } from "./queues.js";

export interface JobRequest {
  readonly queue: QueueName;
  readonly name: string;
  readonly data: object;
  /**
   * BullMQ ignores a job whose ID it already holds, so the same request
   * published twice runs once. IDs may not contain ":".
   */
  readonly jobId: string;
  /** When to run it and how to retry it, if not as the queue's defaults say. */
  readonly options?: Pick<JobsOptions, "delay" | "attempts" | "backoff">;
}

/** Puts jobs on BullMQ queues. */
export class JobPublisher {
  constructor(private readonly queues: ReadonlyMap<QueueName, Queue>) {}

  async publish(job: JobRequest): Promise<void> {
    const queue = this.queues.get(job.queue);
    if (queue === undefined) {
      throw new Error(`No queue named ${job.queue}`);
    }
    await queue.add(job.name, job.data, { ...job.options, jobId: job.jobId });
  }
}
