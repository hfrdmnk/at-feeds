export type DatabaseSchema = {
  post: Post
  sub_state: SubState
  indieweb_post: IndiewebPost
}

export type Post = {
  uri: string
  cid: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}

export type IndiewebPost = {
  uri: string
  cid: string
  author: string
  indexedAt: string
}
