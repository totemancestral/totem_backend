import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { TOTEM_JOB, TOTEM_QUEUE } from "./totem.constants";
import { TotemJobPayload } from "./totem.types";

@Injectable()
export class TotemQueueService {
  constructor(
    @InjectQueue(TOTEM_QUEUE)
    private readonly queue: Queue<TotemJobPayload>,
  ) {}

  async enqueue(orderId: string): Promise<void> {
    await this.queue.add(
      TOTEM_JOB,
      { orderId },
      {
        jobId: orderId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1_000,
        },
        removeOnComplete: {
          age: 30 * 24 * 60 * 60,
          count: 10_000,
        },
        removeOnFail: {
          age: 30 * 24 * 60 * 60,
          count: 10_000,
        },
      },
    );
  }
}
