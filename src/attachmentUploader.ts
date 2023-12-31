import {
  APIAttachment,
  AttachmentBuilder,
  WebhookClient,
} from "discord.js";
import {
  Stream,
  Writable,
  WritableOptions,
} from "stream";
import { env } from "./env";

class AttachmentUploader<T extends {
  rs: (value: APIAttachment) => void
  rj: (reason?: any) => void
  data: {
    filename: string
  } & (
    | { buffer: Buffer }
    | { stream: Stream, size: number }
  )
}> extends Writable {
  webhook = new WebhookClient({ url: env.DISCORD_WEBHOOK_URL });

  constructor(opts?: WritableOptions) {
    super({
      ...opts,
      objectMode: true,
    });
  }

  async _writev(
    chunks: {
      chunk: T
      encoding: BufferEncoding
      callback?: () => void
    }[],
    cb: (error?: Error | null | undefined) => void,
  ) {
    // Any write before returning would be cleared soo .nextTick is needed
    process.nextTick(() => {
      this.cork();
      for (let index = nextBatch.length; index--;) {
        const { chunk, encoding, callback } = nextBatch[index];
        // Callback needs to be cleared due to that `cb()` would call them automatically
        nextBatch[index].callback = () => { };
        this.writeAhead(chunk, encoding, callback);
      }
      process.nextTick(() => this.uncork());
    });

    let remainingSize = 1024 ** 2 * 99;
    const currentBatch: typeof chunks = [];
    const nextBatch: typeof chunks = [];
    for (const chunk of chunks) {
      const chunkSize = 'buffer' in chunk.chunk.data
        ? chunk.chunk.data.buffer.length
        : chunk.chunk.data.size;
      if (
        chunkSize > remainingSize
        || currentBatch.length >= 10
      ) {
        nextBatch.push(chunk);
        continue;
      }
      remainingSize -= chunkSize;
      currentBatch.push(chunk);
    }

    const msg = await this.webhook.send({
      files: currentBatch.map(({
        chunk: { data }
      }) => new AttachmentBuilder(
        'buffer' in data
          ? data.buffer
          : data.stream,
        {
          name: data.filename
        }
      ))
    }).catch((err: Error) => err);

    let error;
    if (msg instanceof Error)
      error = msg;
    else if (msg.attachments.length !== currentBatch.length)
      error = new Error(`Sent files doesn't match the amount sent`);
    else for (const index in currentBatch)
      currentBatch[index].chunk.rs(msg.attachments[index]);
    if (error)
      for (const { chunk: { rj } } of currentBatch)
        rj(error);

    cb();
  }

  write(chunk: T, encoding?: BufferEncoding | undefined, cb?: ((error: Error | null | undefined) => void) | undefined): boolean;
  write(chunk: T, cb?: ((error: Error | null | undefined) => void) | undefined): boolean;
  write(chunk: any, encoding?: any, cb?: any): boolean {
    return super.write(chunk, encoding, cb);
  }

  writeAhead(chunk: T, encoding?: BufferEncoding | undefined, cb?: ((error: Error | null | undefined) => void) | undefined): boolean;
  writeAhead(chunk: T, cb?: ((error: Error | null | undefined) => void) | undefined): boolean;
  writeAhead(chunk: any, encoding?: any, cb?: any): boolean {
    const result = this.write(chunk, encoding, cb) === true;
    const buffer: unknown[] = (<any>this)._writableState.buffered;
    const writtenChunk = buffer.pop();
    if (writtenChunk)
      buffer.unshift(writtenChunk);
    return result;
  }

}

const attachmentUploader = new AttachmentUploader();

export async function upload(
  data:
    | { stream: Stream, size: number }
    | { buffer: Buffer },
  filename: string,
) {
  return await new Promise<APIAttachment>((rs, rj) => {
    attachmentUploader.cork();
    attachmentUploader.write({
      rs, rj,
      data: { ...data, filename },
    });
    process.nextTick(() => attachmentUploader.uncork());
  });
}
