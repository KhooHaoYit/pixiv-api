import {
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  IllustType,
  getArtwork,
  getArtworkAnimation,
} from './pixiv';
import fetch from 'node-fetch';
import { PrismaService } from 'nestjs-prisma';
import { upload } from './attachmentUploader';
import { SizeExtractor } from '@khoohaoyit/image-size';
import {
  basename,
  join,
} from 'path';
import { pipeline } from 'stream/promises';
import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { createReadStream, createWriteStream } from 'fs';
import { spawn } from 'child_process';

@Injectable()
export class AppService implements OnApplicationBootstrap {

  tmpFolder = join(tmpdir(), 'pixiv-api');

  constructor(
    private prisma: PrismaService,
  ) { }

  async onApplicationBootstrap() {
    await rm(this.tmpFolder, { recursive: true, force: true });
    await mkdir(this.tmpFolder);
    const unzip = spawn('unzip', ['-v']);
    await new Promise(rs => unzip.once('exit', rs));
    if (unzip.exitCode)
      throw new Error(`Failed to run \`unzip\` at startup`);
    const ffmpeg = spawn('ffmpeg', ['-version']);
    await new Promise(rs => ffmpeg.once('exit', rs));
    if (ffmpeg.exitCode)
      throw new Error(`Failed to run \`ffmpeg\` at startup`);
  }

  async scrapePost(postId: string) {
    const data = await getArtwork(postId);
    await Promise.all([
      this.#handleAttachments(data),
      this.#handleArtwork(data),
      this.#handleUser(data),
    ]);
  }

  async #handleUser(post: Awaited<ReturnType<typeof getArtwork>>) {
    await this.#ensureUserUpdated({
      id: post.author.id,
      avatar: {
        url: post.author.avatarUrl,
        filename: post.author.avatarFilename,
      },
      handle: post.author.hanndle,
      username: post.author.username,
    });
  }

  async #ensureUserUpdated(
    user: {
      id: string
      avatar?: {
        url: string
        filename: string
      }
      handle?: string
      username?: string
    }
  ) {
    const newAvatarUrl = !user.avatar
      ? undefined
      : await this.prisma.user.findUnique({
        where: { id: user.id },
      }).then(async dbUser => {
        if (
          dbUser?.avatarUrl
          && (
            basename(new URL(dbUser.avatarUrl).pathname)
            === user.avatar!.filename
          )
        ) return;
        // content-length might not be populated on first fetch
        await fetch(user.avatar!.url, {
          method: 'head',
          headers: { referer: 'https://www.pixiv.net/' },
        });
        const res = await fetch(user.avatar!.url, {
          headers: { referer: 'https://www.pixiv.net/' },
        });
        const size = +<string>res.headers.get('content-length');
        if (!res.ok || !size || Number.isNaN(size))
          throw new Error(`Failed to fetch attachment, status: ${res.status}, content-length: ${res.headers.get('content-length')}`);
        const file = await upload({ stream: res.body, size }, user.avatar!.filename);
        return file.url;
      });
    await this.prisma.user.upsert({
      where: { id: user.id },
      update: {
        handle: user.handle,
        avatarUrl: newAvatarUrl,
        username: user.username,
      },
      create: {
        id: user.id,
        handle: user.handle,
        avatarUrl: newAvatarUrl,
        username: user.username,
      },
    });
  }

  async #handleArtwork(post: Awaited<ReturnType<typeof getArtwork>>) {
    await this.#ensureArtworkUpdated({
      id: post.id,
      bookmarks: post.bookmarks,
      comments: post.comments,
      description: post.description,
      likes: post.likes,
      title: post.title,
      views: post.views,
      authorId: post.author.id,
    });
  }

  async #ensureArtworkUpdated(
    post: {
      id: string
      attachmentIds?: string[]
      bookmarks?: number,
      comments?: number
      description?: string
      likes?: number
      title?: string
      views?: number
      authorId?: string
    }
  ) {
    await this.prisma.artwork.upsert({
      where: { id: post.id },
      update: {
        attachmentIds: post.attachmentIds,
        bookmarks: post.bookmarks,
        comments: post.comments,
        description: post.description,
        likes: post.likes,
        title: post.title,
        views: post.views,
        author: post.authorId
          ? {
            connectOrCreate: {
              where: { id: post.authorId },
              create: { id: post.authorId },
            },
          }
          : undefined,
      },
      create: {
        id: post.id,
        attachmentIds: post.attachmentIds,
        bookmarks: post.bookmarks,
        comments: post.comments,
        description: post.description,
        likes: post.likes,
        title: post.title,
        views: post.views,
        author: post.authorId
          ? {
            connectOrCreate: {
              where: { id: post.authorId },
              create: { id: post.authorId },
            },
          }
          : undefined,
      }
    });
  }

  async #handleAttachments(post: Awaited<ReturnType<typeof getArtwork>>) {
    switch (post.type) {
      default: {
        await Promise.all(post.attachments.map(attachment =>
          this.#ensureAttachmentExists(attachment)));
        await this.#ensureArtworkUpdated({
          id: post.id,
          attachmentIds: post.attachments.map(attachment => attachment.id),
        });
      } break;
      case IllustType.Animation: {
        const animation = await getArtworkAnimation(post.id);
        const found = await this.prisma.attachment.findUnique({
          where: { id: animation.id },
        });
        if (found)
          break;
        const workingDir = await mkdtemp(join(this.tmpFolder, `${post.id}-`));
        const gifResult = await fetch(animation.zipUrl, {
          headers: { referer: 'https://www.pixiv.net/' },
        }).then(async res => {
          if (!res.ok)
            throw new Error(`${basename(animation.zipUrl)} returned status code: ${res.status}`);
          await pipeline(
            res.body,
            createWriteStream(join(workingDir, 'images.zip')),
          );
          const unzip = spawn(
            'unzip',
            ['images.zip', '-d', 'images'],
            { cwd: workingDir },
          );
          await new Promise(rs => unzip.once('exit', rs));
          if (unzip.exitCode)
            throw new Error(`unzip exited with code: ${unzip.exitCode}`);
          await writeFile(
            join(workingDir, 'images', 'input.txt'),
            animation.frames
              .map(frame => `file '${frame.file}'\nduration ${frame.delay / 1_000}`)
              .join('\n'),
          );
          const ffmpeg = spawn(
            'ffmpeg',
            [
              '-f', 'concat',
              '-i', 'input.txt',
              '-vf', '[0]split[v][p];[p]palettegen=stats_mode=diff:max_colors=256:reserve_transparent=1[p];[v][p]paletteuse=new=1:alpha_threshold=1:diff_mode=rectangle',
              '-loop', '0',
              'output.gif',
            ],
            { cwd: join(workingDir, 'images') },
          );
          await new Promise(rs => ffmpeg.once('exit', rs));
          if (ffmpeg.exitCode)
            throw new Error(`ffmpeg exited with code: ${ffmpeg.exitCode}`);
          const gifPath = join(workingDir, 'images', 'output.gif');
          const gifStat = await stat(gifPath);
          const sizeExtractor = new SizeExtractor({ passthrough: true });
          const [attachment] = await Promise.all([
            upload({ stream: sizeExtractor, size: gifStat.size }, animation.id + '.gif'),
            pipeline(createReadStream(gifPath), sizeExtractor),
          ]);
          const [[{ width, height }]] = sizeExtractor.sizes;
          return {
            width, height,
            url: attachment.url,
          };
        }).finally(() => rm(workingDir, { recursive: true }));
        if (!gifResult)
          break;
        await this.prisma.attachment.create({
          data: {
            id: animation.id,
            url: gifResult.url,
            width: gifResult.width,
            height: gifResult.height,
          },
        });
        await this.#ensureArtworkUpdated({
          id: post.id,
          attachmentIds: [animation.id],
        });
      } break;
    }
  }

  async #ensureAttachmentExists(
    attachment: {
      id: string
      filename: string
      url: string
    }
  ) {
    const found = await this.prisma.attachment.findUnique({
      where: { id: attachment.id },
      select: { id: true },
    });
    if (found)
      return;
    const extractor = new SizeExtractor({ passthrough: true });
    // content-length might not be populated on first fetch
    await fetch(attachment.url, {
      method: 'head',
      headers: { referer: 'https://www.pixiv.net/' },
    });
    const res = await fetch(attachment.url, {
      headers: { referer: 'https://www.pixiv.net/' },
    });
    const size = +<string>res.headers.get('content-length');
    if (!res.ok || !size || Number.isNaN(size))
      throw new Error(`Failed to fetch attachment, status: ${res.status}, content-length: ${res.headers.get('content-length')}`);
    const [file] = await Promise.all([
      upload({ stream: extractor, size }, attachment.filename),
      pipeline(
        res.body,
        extractor,
      ),
    ]);
    const [[{ width, height }]] = extractor.sizes;
    await this.prisma.attachment.create({
      data: {
        id: attachment.id,
        url: file.url,
        height, width,
      },
    });
  }

}
