import fetch from 'node-fetch';

export async function getArtwork(artworkId: string) {
  const data = await fetch(`https://www.pixiv.net/ajax/illust/${artworkId}?lang=en&version=9999658d4318bf586639ea44559e9fbd2353632c`)
    .then(res => res.json() as Promise<GetArtworkResult>);
  const imageFilename = data.body.urls.original
    .split('/img/').at(-1)!
    .replace(/\/(?=[^/]*$)/, '_')
    .replace(/\//g, '');
  return {
    id: data.body.id,
    likes: data.body.likeCount,
    bookmarks: data.body.bookmarkCount,
    comments: data.body.commentCount,
    views: data.body.viewCount,
    title: data.body.title,
    description: data.body.extraData.meta.twitter.description,
    type: data.body.illustType satisfies IllustType,
    attachments: Array(data.body.pageCount)
      .fill(0)
      .map((_, index) => ({
        id: imageFilename.replace('p0', `p${index}`).split('.')[0],
        filename: imageFilename.replace('p0', `p${index}`),
        url: data.body.urls.original.replace('p0', `p${index}`),
      })),
    author: {
      id: data.body.userId,
      username: data.body.userName,
      hanndle: data.body.userAccount,
      avatarUrl: data.body.noLoginData.zengoIdWorks
        .find(work => work.id === artworkId)!
        .profileImageUrl.replace(/_\d+(?=\.)/, ''),
      avatarFilename: data.body.noLoginData.zengoIdWorks
        .find(work => work.id === artworkId)!
        .profileImageUrl.replace(/_\d+(?=\.)/, '')
        .split('/img/').at(-1)!
        .replace(/\/(?=[^/]*$)/, '_')
        .replace(/\//g, ''),
    },
  };
}

export async function getArtworkAnimation(artworkId: string) {
  const data = await fetch(`https://www.pixiv.net/ajax/illust/${artworkId}/ugoira_meta?lang=en&version=bf07d0532eb0d64f97fc7ee14124b809cad3d6d3`)
    .then(res => res.json() as Promise<GetArtworkAnimation>);
  return {
    zipUrl: data.body.src,
    id: data.body.src
      .split('/img/').at(-1)!
      .replace(/\/(?=[^/]*$)/, '_')
      .replace(/\//g, '')
      .replace('.zip', ''),
    frames: data.body.frames,
  };
}

export enum IllustType {
  Illustration = 0,
  Manga = 1,
  Animation = 2,
}

type GetArtworkAnimation = {
  body: {
    src: string
    originalSrc: string
    mine_type: string
    frames: {
      file: string
      delay: number
    }[]
  }
}

type GetArtworkResult = {
  body: {
    id: string
    title: string
    likeCount: number
    bookmarkCount: number
    commentCount: number
    viewCount: number
    illustType: IllustType
    extraData: {
      meta: {
        twitter: {
          description: string
        }
      }
    }
    createDate: string
    pageCount: number
    urls: {
      original: string
    }
    userId: string
    userName: string
    userAccount: string
    noLoginData: {
      zengoIdWorks: {
        id: string
        profileImageUrl: string
        userId: string
      }[]
    }
  }
  error: false
  message: ''
}
