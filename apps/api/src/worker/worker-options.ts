/** How the worker process behaves; tests turn the background loops off. */
export interface WorkerOptions {
  /**
   * Start the outbox relay loop and the queue consumers. Tests that drive
   * each step by hand (relayOnce, process) leave this off, so nothing runs
   * behind their back.
   */
  readonly consume: boolean;
}

export const WORKER_OPTIONS = Symbol("WORKER_OPTIONS");
