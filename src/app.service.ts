import { ConsoleLogger, Injectable } from '@nestjs/common';
import { getPost } from './pixiv';
import fetch from 'node-fetch';
import { PrismaService } from 'nestjs-prisma';
import { upload } from './attachmentUploader';
import { SizeExtractor } from '@khoohaoyit/image-size';
import { basename } from 'path';
import { pipeline } from 'stream/promises';

@Injectable()
export class AppService {

  constructor(
    private prisma: PrismaService,
  ) { }

  async scrapePost(postId: string) {
    const data = await getPost(postId);
    await Promise.all([
      this.#handleAttachments(data),
      this.#handleArtwork(data),
      this.#handleUser(data),
    ]);
  }

  async #handleUser(post: Awaited<ReturnType<typeof getPost>>) {
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

  async #handleArtwork(post: Awaited<ReturnType<typeof getPost>>) {
    await this.#ensureArtworkUpdated({
      id: post.id,
      attachmentIds: post.attachments.map(attachment => attachment.id),
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
      attachmentIds: string[]
      bookmarks: number,
      comments: number
      description: string
      likes: number
      title: string
      views: number
      authorId: string
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
        author: {
          connectOrCreate: {
            where: { id: post.authorId },
            create: { id: post.authorId },
          },
        },
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
        author: {
          connectOrCreate: {
            where: { id: post.authorId },
            create: { id: post.authorId },
          },
        },
      }
    });
  }

  async #handleAttachments(post: Awaited<ReturnType<typeof getPost>>) {
    await Promise.all(post.attachments.map(attachment =>
      this.#ensureAttachmentExists(attachment)));
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
