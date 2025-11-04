import { Record as PostRecord } from '../lexicon/types/app/bsky/feed/post'
import * as AppBskyRichtextFacet from '../lexicon/types/app/bsky/richtext/facet'
import * as AppBskyEmbedExternal from '../lexicon/types/app/bsky/embed/external'

/**
 * Extract all URLs from a post record
 * Checks both facets (inline links) and external embeds (link cards)
 */
export function extractAllLinks(post: PostRecord): string[] {
  const links: string[] = []

  // Extract links from facets (inline links in text)
  if (post.facets) {
    for (const facet of post.facets) {
      for (const feature of facet.features) {
        if (AppBskyRichtextFacet.isLink(feature)) {
          links.push(feature.uri)
        }
      }
    }
  }

  // Extract links from external embeds (link preview cards)
  if (post.embed && AppBskyEmbedExternal.isMain(post.embed)) {
    links.push(post.embed.external.uri)
  }

  return links
}

/**
 * Extract domain from a URL
 * Examples:
 *   https://example.com/path -> example.com
 *   http://www.example.com -> www.example.com
 *   https://blog.example.com/post -> blog.example.com
 *
 * Does NOT normalize domains (blog.example.com ≠ example.com)
 */
export function getDomainFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.toLowerCase()
  } catch (err) {
    console.error('Failed to parse URL:', url, err)
    return null
  }
}

