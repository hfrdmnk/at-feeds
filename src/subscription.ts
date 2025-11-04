import { DidResolver } from '@atproto/identity'
import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { extractAllLinks, getDomainFromUrl } from './util/indieweb'
import { IndiewebMappings } from './util/csv-mappings'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  private indiewebMappings: IndiewebMappings

  constructor(
    db: any,
    service: string,
    didResolver: DidResolver,
    indiewebMappings: IndiewebMappings,
  ) {
    super(db, service, didResolver)
    this.indiewebMappings = indiewebMappings
  }

  /**
   * Get handle from DID using the DID resolver
   * Returns null if handle cannot be resolved
   */
  private async getHandleFromDid(did: string): Promise<string | null> {
    try {
      const didDoc = await this.didResolver.resolve(did)
      if (!didDoc) return null

      // Extract handle from DID document alsoKnownAs
      // Format: at://handle or handle
      const alsoKnownAs = didDoc.alsoKnownAs?.[0]
      if (!alsoKnownAs) return null

      // Remove at:// prefix if present
      const handle = alsoKnownAs.replace('at://', '')
      return handle
    } catch (err) {
      console.error('Failed to resolve DID to handle:', did, err)
      return null
    }
  }

  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    // IndieWeb posts indexing
    const indiewebPostsToDelete = ops.posts.deletes.map((del) => del.uri)
    const indiewebPostsToCreate: {
      uri: string
      cid: string
      author: string
      indexedAt: string
    }[] = []

    for (const create of ops.posts.creates) {
      // Extract all links from the post
      const links = extractAllLinks(create.record)

      // Skip posts without links
      if (links.length === 0) continue

      // Resolve DID to handle
      const handle = await this.getHandleFromDid(create.author)
      if (!handle) {
        // Skip if we can't resolve the handle
        continue
      }

      // Check if this handle has custom mappings in CSV
      const csvMappedDomains = this.indiewebMappings.getDomainsForHandle(handle)

      // Check if any link domain matches
      let hasMatch = false
      for (const link of links) {
        const domain = getDomainFromUrl(link)
        if (!domain) continue

        // Check 1: Direct handle match (for custom domain handles)
        // Only if NOT a bsky.social handle (unless explicitly in CSV)
        if (
          !handle.endsWith('.bsky.social') &&
          domain.toLowerCase() === handle.toLowerCase()
        ) {
          hasMatch = true
          break
        }

        // Check 2: CSV mapping match
        if (
          csvMappedDomains.some((mappedDomain) => mappedDomain === domain.toLowerCase())
        ) {
          hasMatch = true
          break
        }
      }

      // If at least one link matches, index this post
      if (hasMatch) {
        indiewebPostsToCreate.push({
          uri: create.uri,
          cid: create.cid,
          author: create.author,
          indexedAt: new Date().toISOString(),
        })
      }
    }

    // Delete removed posts from indieweb_post table
    if (indiewebPostsToDelete.length > 0) {
      await this.db
        .deleteFrom('indieweb_post')
        .where('uri', 'in', indiewebPostsToDelete)
        .execute()
    }

    // Insert new IndieWeb posts
    if (indiewebPostsToCreate.length > 0) {
      await this.db
        .insertInto('indieweb_post')
        .values(indiewebPostsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}
