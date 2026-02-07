# RSS MCP Server

![RSS MCP Server](https://repository-images.githubusercontent.com/1150674405/60bced96-ed2d-4f45-8f16-397fdffd7ef2)

An MCP server that lets AI assistants subscribe to, fetch, search, and manage RSS feeds. Built with TypeScript and SQLite with full-text search.

## Inspiration

Inspired by [Andrej Karpathy's post](https://x.com/karpathy/status/2018043254986703167) on reclaiming your information diet:

> "Finding myself going back to RSS/Atom feeds a lot more recently. There's a lot more higher quality longform and a lot less slop intended to provoke... We should bring back RSS - it's open, pervasive, hackable."

**Quick start with curated feeds**: Import the [Most Popular Blogs of Hacker News 2025](https://gist.github.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b) OPML file to get 92 high-quality tech blogs:

```
import the OPML file from https://gist.github.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b
```

Claude will automatically use the `import_opml` tool to add all feeds.

## Features

- Subscribe to RSS/Atom feeds and fetch new posts
- Full-text search across titles, summaries, and content (FTS5)
- Extract clean article content from web pages (Readability)
- Import feeds in bulk from OPML files
- Track read/unread state
- Daily digest for compact summaries
- HackerNews popularity ranking for posts
- Conditional HTTP requests (ETag/Last-Modified) and per-feed rate limiting

## Installation

### As a Claude Code Plugin (Recommended)

```bash
/plugin marketplace add 0xQuinto/rss-mcp
/plugin install rss-mcp@0xquinto-rss-mcp
```

### Via bunx

```bash
bunx @0xquinto/rss-mcp
```

### Via npx

```bash
npx @0xquinto/rss-mcp
```

## Tools

| Tool                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `list_feeds`        | List all subscribed feeds                                         |
| `add_feed`          | Subscribe to a feed by URL                                        |
| `remove_feed`       | Unsubscribe and delete all posts for a feed                       |
| `import_opml`       | Bulk import feeds from an OPML file                               |
| `refresh_feeds`     | Fetch latest posts (all feeds or a specific one)                  |
| `get_posts`         | Query posts with filtering, pagination, and full-text search      |
| `get_post_content`  | Retrieve article content with pagination (`max_length`, `offset`) |
| `get_daily_digest`  | Get compact digest of recent posts for synthesis                  |
| `get_popular_posts` | Rank recent posts by HackerNews engagement                        |
| `mark_read`         | Mark posts as read                                                |
| `mark_unread`       | Mark posts as unread                                              |

### `get_post_content`

Retrieves article content with chunked reading support for long articles (e.g. interview transcripts).

| Parameter    | Type   | Default | Description                                           |
| ------------ | ------ | ------- | ----------------------------------------------------- |
| `post_id`    | number | —       | ID of the post (required)                             |
| `max_length` | number | 5000    | Max characters per chunk. Use 100000 for full content |
| `offset`     | number | 0       | Character offset to start reading from                |

The response includes `total_length`, `offset`, `chunk_length`, and `truncated` so you can paginate through long content:

```
get_post_content(post_id=123, max_length=20000, offset=0)
get_post_content(post_id=123, max_length=20000, offset=20000)
# ...continue until truncated=false
```

Content is fetched from the original URL and cached on first access.

## Data

Posts are stored in `~/.rss-mcp/rss.db` (SQLite). The database and FTS5 index are created automatically on first run.

## MCP Configuration

### Claude Code

Add to your project or user MCP settings:

```json
{
  "mcpServers": {
    "rss-mcp": {
      "command": "bunx",
      "args": ["@0xquinto/rss-mcp"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rss-mcp": {
      "command": "bunx",
      "args": ["@0xquinto/rss-mcp"]
    }
  }
}
```

## License

MIT
