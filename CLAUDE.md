# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ATProto Feed Generator for Bluesky, hosted at **feeds.dominik.social**. It provides custom feed algorithms that users can subscribe to in the Bluesky app. The service listens to the ATProto firehose, indexes posts based on custom logic, and serves feed skeletons via XRPC endpoints.

## Common Commands

```bash
# Development
npm start                    # Start the feed generator server
npm run build                # Compile TypeScript to JavaScript

# Feed Management
npm run publishFeed          # Publish a new feed or update existing feed metadata
npm run unpublishFeed        # Remove a feed from Bluesky (prompts for recordName)
```

## Architecture Overview

### Application Flow

The application follows this lifecycle:
1. **Startup** (`src/index.ts`) → Creates `FeedGenerator` instance → Initializes database, firehose subscription, and HTTP server
2. **Database migrations** run automatically on startup
3. **Firehose subscription** begins from last known cursor position (stored in `sub_state` table)
4. **HTTP server** listens for XRPC requests from Bluesky PDS servers

### Feed Algorithm System

Feeds are registered as a plugin system in `src/algos/`:
- Each algorithm exports a `shortname` (max 15 chars) and a `handler` function
- The `shortname` becomes the `rkey` in the feed's at-uri: `at://{publisherDid}/app.bsky.feed.generator/{shortname}`
- All algorithms are registered in `src/algos/index.ts` in the `algos` object
- The XRPC handler looks up algorithms by their shortname when processing feed requests

**To add a new feed algorithm:**
1. Create a new file in `src/algos/` (e.g., `my-feed.ts`)
2. Export `shortname` and `handler` following the pattern in `whats-alf.ts`
3. Import and register in `src/algos/index.ts`
4. Run `npm run publishFeed` and use the same `recordName` as your `shortname`

### Firehose Subscription and Indexing

**Architecture** (`src/subscription.ts`):
- Extends `FirehoseSubscriptionBase` which manages WebSocket connection to `wss://bsky.network`
- Processes commit events from the firehose in real-time
- Uses `getOpsByType()` to extract CREATE and DELETE operations from commits
- Custom indexing logic lives in the `handleEvent()` method

**Cursor Management:**
- Current position in firehose is persisted to `sub_state` table every 20 events
- On restart, subscription resumes from last cursor to avoid re-indexing
- Critical for production: prevents data loss and duplicate processing

**Default Implementation:**
- Filters for posts containing "alf" (case-insensitive)
- Stores post URI, CID, and indexedAt timestamp
- Handles deletes when posts are removed from network

### Database Schema

Uses **better-sqlite3** (synchronous) with **Kysely** query builder for type safety.

**Tables:**
- `post`: Stores indexed posts (`uri` PK, `cid`, `indexedAt`)
- `sub_state`: Tracks firehose cursor position (`service` PK, `cursor`)

**Migrations:**
- Defined in `src/db/migrations.ts` as versioned objects
- Run automatically via `migrateToLatest()` on startup
- Add new migrations with incremented version numbers

### Request Flow (End-to-End)

1. User subscribes to feed: `at://did:web:feeds.dominik.social/app.bsky.feed.generator/{shortname}`
2. User's PDS resolves service DID → Fetches `https://feeds.dominik.social/.well-known/did.json`
3. PDS sends `getFeedSkeleton` request with JWT authentication
4. Feed generator:
   - Verifies JWT (`src/auth.ts`)
   - Extracts shortname from feed URI
   - Looks up algorithm in `algos` registry
   - Calls handler with `AppContext` and query params
   - Returns skeleton: `{ cursor, feed: [{ post: uri }] }`
5. PDS hydrates skeleton with full post data and returns to user

### Publishing Feeds

**Script:** `scripts/publishFeedGen.ts`

Creates an `app.bsky.feed.generator` record in your Bluesky repo that points to this service.

**Process:**
1. Prompts for Bluesky credentials (use App Password, not main password)
2. Prompts for feed metadata:
   - `recordName`: Must match your algorithm's `shortname`
   - `displayName`: User-facing name shown in app
   - `description`: Optional description
   - `avatar`: Optional image path (PNG/JPG)
   - `videoOnly`: Set content mode to "video" for immersive video feeds
3. Uploads avatar blob if provided
4. Creates/updates feed generator record with `did` pointing to `FEEDGEN_SERVICE_DID` or `did:web:feeds.dominik.social`

**Important:** The `recordName` you choose during publishing becomes part of the feed URI and must match your algorithm's `shortname` for the feed to work.

### Environment Configuration

**Critical variables** (set in `.env`):
- `FEEDGEN_HOSTNAME="feeds.dominik.social"` - Your domain (used for did:web)
- `FEEDGEN_PUBLISHER_DID` - DID of the account publishing feed records
- `FEEDGEN_PORT=3000` - HTTP server port
- `FEEDGEN_SQLITE_LOCATION` - Database file path (use `./data/db.sqlite` for production, not `:memory:`)
- `FEEDGEN_SUBSCRIPTION_ENDPOINT="wss://bsky.network"` - Firehose WebSocket URL

**Optional:**
- `FEEDGEN_SERVICE_DID` - Override service DID (defaults to `did:web:{FEEDGEN_HOSTNAME}`)
- `FEEDGEN_LISTENHOST` - Bind address (default: `localhost`)
- `FEEDGEN_SUBSCRIPTION_RECONNECT_DELAY` - Milliseconds between reconnect attempts (default: 3000)

## Key Implementation Patterns

### AppContext Dependency Injection

All algorithm handlers and XRPC methods receive `AppContext` containing:
- `db`: Kysely database instance (shared across requests)
- `didResolver`: DID resolver with caching
- `cfg`: Configuration object

### Cursor-Based Pagination

Cursors are opaque strings fully controlled by each algorithm:
- Common pattern: timestamp of last returned post (e.g., `"1683654690921"`)
- Enables stable pagination even with concurrent updates
- Each algorithm can use different cursor formats

### Type-Safe Lexicon Integration

- XRPC method types auto-generated from ATProto lexicons
- Runtime validation via `lexicons.assertValidRecord()`
- Invalid records from firehose are skipped (logged but don't crash)

### Authentication (Optional)

JWT verification in `src/auth.ts`:
- Only needed if feed personalizes results per user (e.g., based on follows)
- Validates JWT signature using requestor's ATProto signing key
- Returns requestor's DID for use in algorithm logic

## Deployment (Coolify/Production)

**Requirements:**
- HTTPS on port 443 (for XRPC and DID resolution)
- Persistent SQLite database (set `FEEDGEN_SQLITE_LOCATION` to file path)
- Environment variables properly configured
- Domain must match `FEEDGEN_HOSTNAME` for did:web to work

**Health Check:**
- `GET /.well-known/did.json` - Should return DID document
- `GET /xrpc/app.bsky.feed.describeFeedGenerator` - Should list available feeds

## Multiple Feeds in One Service

This service can host multiple feed algorithms simultaneously:
- Each algorithm has its own `shortname`
- Register all algorithms in `src/algos/index.ts`
- Publish each feed separately via `npm run publishFeed` (can use same or different Bluesky accounts)
- Each feed gets its own at-uri based on publisher DID + recordName

## Common Customizations

**Modify indexing logic:**
Edit `src/subscription.ts` `handleEvent()` to change which posts are indexed. You can filter by:
- Text content (keywords, hashtags, mentions)
- Author DID (specific users or communities)
- Post metadata (has images, videos, links, etc.)
- Engagement metrics (likes, reposts - requires indexing those records too)

**Extend database schema:**
Add new tables/columns in a new migration in `src/db/migrations.ts`, update `DatabaseSchema` in `src/db/schema.ts`, and increment migration version.

**Customize feed sorting:**
Modify algorithm handlers in `src/algos/` to change ordering (e.g., by engagement score instead of recency).
