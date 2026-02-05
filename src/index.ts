#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";

import * as db from "./db.js";
import { fetchFeed, parseFeed } from "./feeds.js";
import { fetchHNScore } from "./hn.js";
import { parseOpml } from "./opml.js";
import { fetchAndExtract } from "./content.js";

const server = new McpServer({
  name: "rss-mcp",
  version: "1.0.0",
});

// Tool: list_feeds
server.tool("list_feeds", {}, async () => {
  const feeds = db.listFeeds();
  return {
    content: [{ type: "text", text: JSON.stringify(feeds, null, 2) }],
  };
});

// Tool: add_feed
server.tool(
  "add_feed",
  { url: z.string().describe("RSS/Atom feed URL to subscribe to") },
  async ({ url }) => {
    try {
      const feed = db.addFeed(url);
      return {
        content: [{ type: "text", text: JSON.stringify(feed, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// Tool: remove_feed
server.tool(
  "remove_feed",
  { feed_id: z.number().describe("ID of the feed to remove") },
  async ({ feed_id }) => {
    const removed = db.removeFeed(feed_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ removed }) }],
    };
  },
);

// Tool: import_opml
server.tool(
  "import_opml",
  { file_path: z.string().describe("Path to OPML file") },
  async ({ file_path }) => {
    try {
      const text = readFileSync(file_path, "utf-8");
      const feeds = parseOpml(text);
      let imported = 0;
      for (const f of feeds) {
        try {
          db.addFeed(f.url, f.title, f.siteUrl);
          imported++;
        } catch {
          // Skip duplicates
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ imported, total_in_file: feeds.length }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// Tool: refresh_feeds
server.tool(
  "refresh_feeds",
  {
    feed_id: z
      .number()
      .optional()
      .describe("Optional specific feed ID to refresh"),
  },
  async ({ feed_id }) => {
    const feeds = feed_id
      ? [db.getFeed(feed_id)].filter(Boolean)
      : db.listFeeds();
    const minInterval = 15 * 60 * 1000; // 15 minutes
    const now = Date.now();

    const results = {
      refreshed: 0,
      new_posts: 0,
      skipped: 0,
      errors: [] as { feed_id: number; url: string; error: string }[],
    };

    for (const feed of feeds) {
      if (!feed) continue;

      // Check rate limit
      if (feed.last_fetched) {
        const lastFetched = new Date(feed.last_fetched).getTime();
        if (now - lastFetched < minInterval) {
          results.skipped++;
          continue;
        }
      }

      try {
        const { xml, etag, lastModified } = await fetchFeed(
          feed.url,
          feed.etag,
          feed.last_modified,
        );

        if (xml === null) {
          results.skipped++;
          continue;
        }

        const { title, siteUrl, entries } = parseFeed(xml);
        const count = db.upsertPosts(feed.id, entries);
        db.updateFeedMeta(feed.id, title, siteUrl, etag, lastModified);

        results.refreshed++;
        results.new_posts += count;
      } catch (error) {
        results.errors.push({
          feed_id: feed.id,
          url: feed.url,
          error: String(error),
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
);

// Tool: get_posts
server.tool(
  "get_posts",
  {
    feed_id: z.number().optional().describe("Filter by feed ID"),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Maximum posts to return"),
    offset: z.number().optional().default(0).describe("Pagination offset"),
    unread_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("Only return unread posts"),
    search: z.string().optional().describe("FTS5 full-text search query"),
    since: z
      .string()
      .optional()
      .describe("ISO 8601 date to filter posts after"),
  },
  async ({ feed_id, limit, offset, unread_only, search, since }) => {
    const posts = db.getPosts({
      feedId: feed_id,
      limit,
      offset,
      unreadOnly: unread_only,
      search,
      since,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(posts, null, 2) }],
    };
  },
);

// Tool: get_post_content
server.tool(
  "get_post_content",
  {
    post_id: z.number().describe("ID of the post"),
    full: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return full content without truncation"),
  },
  async ({ post_id, full }) => {
    let result = db.getPostContent(post_id, full);

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Post ${post_id} not found` }),
          },
        ],
        isError: true,
      };
    }

    // If no content yet, fetch it
    if (!result.content && result.url) {
      const extractedContent = await fetchAndExtract(result.url);
      if (extractedContent) {
        db.updatePostContent(post_id, extractedContent);
        result = db.getPostContent(post_id, full);
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// Tool: get_daily_digest
server.tool(
  "get_daily_digest",
  {
    hours: z.number().optional().default(24).describe("Hours to look back"),
    max_summary_length: z
      .number()
      .optional()
      .default(300)
      .describe("Max chars per summary"),
  },
  async ({ hours, max_summary_length }) => {
    const posts = db.getDailyDigest(hours, max_summary_length);
    const feeds = new Set(posts.map((p) => p.feed));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              period: `last ${hours}h`,
              total_posts: posts.length,
              feeds: feeds.size,
              posts,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Tool: mark_read
server.tool(
  "mark_read",
  {
    post_ids: z.array(z.number()).describe("Array of post IDs to mark as read"),
  },
  async ({ post_ids }) => {
    const marked = db.markRead(post_ids);
    return {
      content: [{ type: "text", text: JSON.stringify({ marked }) }],
    };
  },
);

// Tool: mark_unread
server.tool(
  "mark_unread",
  {
    post_ids: z
      .array(z.number())
      .describe("Array of post IDs to mark as unread"),
  },
  async ({ post_ids }) => {
    const marked = db.markUnread(post_ids);
    return {
      content: [{ type: "text", text: JSON.stringify({ marked }) }],
    };
  },
);

// Tool: get_popular_posts
server.tool(
  "get_popular_posts",
  {
    days: z.number().optional().default(7).describe("Days to look back"),
    limit: z.number().optional().default(10).describe("Max posts to return"),
  },
  async ({ days, limit }) => {
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const posts = db.getPosts({ since, limit: 500 });

    const results: Array<{
      id: number;
      feed: string;
      title: string | null;
      url: string | null;
      published_at: string | null;
      hn_score: number;
      hn_comments: number;
      hn_url: string;
    }> = [];

    // Fetch HN scores concurrently (max 5 at a time)
    const chunks = [];
    for (let i = 0; i < posts.length; i += 5) {
      chunks.push(posts.slice(i, i + 5));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (post) => {
          if (!post.url) return null;
          const hn = await fetchHNScore(post.url);
          if (!hn) return null;
          return {
            id: post.id,
            feed: post.feed_title ?? "",
            title: post.title,
            url: post.url,
            published_at: post.published_at,
            hn_score: hn.score,
            hn_comments: hn.comments,
            hn_url: hn.hn_url,
          };
        }),
      );
      results.push(
        ...chunkResults.filter((r): r is NonNullable<typeof r> => r !== null),
      );
    }

    // Sort by HN score and take top N
    const ranked = results
      .sort((a, b) => b.hn_score - a.hn_score)
      .slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              period: `last ${days} days`,
              total_checked: posts.length,
              posts: ranked,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RSS MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
