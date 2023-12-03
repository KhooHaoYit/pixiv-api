import fetch from 'node-fetch';

export async function getPost(postId: string) {
  const data = await fetch(`https://www.pixiv.net/ajax/illust/${postId}?lang=en&version=9999658d4318bf586639ea44559e9fbd2353632c`)
    .then(res => res.json() as Promise<Data>);
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
        .find(work => work.id === postId)!
        .profileImageUrl.replace(/_\d+(?=\.)/, ''),
      avatarFilename: data.body.noLoginData.zengoIdWorks
        .find(work => work.id === postId)!
        .profileImageUrl.replace(/_\d+(?=\.)/, '')
        .split('/img/').at(-1)!
        .replace(/\/(?=[^/]*$)/, '_')
        .replace(/\//g, ''),
    },
  };
}

type Data = {
  body: {
    id: string
    title: string
    likeCount: number
    bookmarkCount: number
    commentCount: number
    viewCount: number
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
