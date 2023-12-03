import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from 'nestjs-prisma';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) { }

  @Get('/artworks/:id')
  async getArtwork(
    @Param('id') id: string,
    @Query() {
      includeAttachments,
      includeAuthor,
    }: Record<'includeAttachments' | 'includeAuthor', string>,
  ) {
    const data = await this.prisma.artwork.findUnique({
      where: { id },
      include: { author: !!includeAuthor },
    });
    if (!data)
      return JSON.stringify(null);
    const attachments = !includeAttachments
      ? undefined
      : await this.prisma.attachment.findMany({
        where: { id: { in: data.attachmentIds } },
      }).then(attachments => Object.fromEntries(
        attachments?.map(attachment => [attachment.id, attachment])
        ?? []
      ));
    return {
      ...data,
      attachments,
    };
  }

  @Post('/artworks/:id/fetch')
  async fetchArtwork(
    @Param('id') id: string,
    @Query() includes: Record<'includeAttachments' | 'includeAuthor', string>,
  ) {
    await this.appService.scrapePost(id);
    return await this.getArtwork(id, includes);
  }

}
