import { parseFeed as parseRssFeed } from "feedsmith";
import type { Feed } from "feedsmith";
import type { PostEntry } from "./db.js";

export interface FetchResult {
  xml: string | null;
  etag: string | null;
  lastModified: string | null;
}

export async function fetchFeed(
  url: string,
  etag?: string | null,
  lastModified?: string | null,
): Promise<FetchResult> {
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  const response = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });

  if (response.status === 304) {
    return { xml: null, etag: null, lastModified: null };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const xml = await response.text();
  return {
    xml,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

export interface ParsedFeed {
  title: string | null;
  siteUrl: string | null;
  entries: PostEntry[];
}

function toISOString(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function extractEntries(result: Feed): PostEntry[] {
  switch (result.type) {
    case "rss": {
      const feed = result.feed;
      return (feed.items ?? []).map((item) => ({
        guid: item.guid ?? item.link ?? "",
        title: item.title,
        url: item.link,
        summary: item.description,
        author: item.authors?.[0],
        published_at: toISOString(item.pubDate ?? item.dc?.date),
      }));
    }
    case "atom": {
      const feed = result.feed;
      return (feed.entries ?? []).map((entry) => {
        const link =
          entry.links?.find((l) => l.rel === "alternate")?.href ??
          entry.links?.[0]?.href;
        let authorStr: string | undefined;
        if (entry.authors?.[0]) {
          authorStr = entry.authors[0].name ?? entry.authors[0].email;
        }
        return {
          guid: entry.id ?? link ?? "",
          title: typeof entry.title === "string" ? entry.title : undefined,
          url: link,
          summary:
            typeof entry.summary === "string"
              ? entry.summary
              : typeof entry.content === "string"
                ? entry.content
                : undefined,
          author: authorStr,
          published_at: toISOString(entry.published ?? entry.updated),
        };
      });
    }
    case "json": {
      const feed = result.feed;
      return (feed.items ?? []).map((item) => ({
        guid: item.id ?? item.url ?? "",
        title: item.title,
        url: item.url,
        summary: item.summary ?? item.content_html ?? item.content_text,
        author: item.authors?.[0]?.name,
        published_at: toISOString(item.date_published ?? item.date_modified),
      }));
    }
    case "rdf": {
      const feed = result.feed;
      return (feed.items ?? []).map((item) => ({
        guid: item.link ?? "",
        title: item.title,
        url: item.link,
        summary: item.description,
        author: item.dc?.creator,
        published_at: toISOString(item.dc?.date),
      }));
    }
  }
}

function extractFeedMeta(result: Feed): {
  title: string | null;
  siteUrl: string | null;
} {
  switch (result.type) {
    case "rss":
      return {
        title: result.feed.title ?? null,
        siteUrl: result.feed.link ?? null,
      };
    case "atom": {
      const link =
        result.feed.links?.find((l) => l.rel === "alternate")?.href ??
        result.feed.links?.[0]?.href;
      return {
        title: typeof result.feed.title === "string" ? result.feed.title : null,
        siteUrl: link ?? null,
      };
    }
    case "json":
      return {
        title: result.feed.title ?? null,
        siteUrl: result.feed.home_page_url ?? null,
      };
    case "rdf":
      return {
        title: result.feed.title ?? null,
        siteUrl: result.feed.link ?? null,
      };
  }
}

export function parseFeed(xml: string): ParsedFeed {
  const result = parseRssFeed(xml);
  const meta = extractFeedMeta(result);
  const entries = extractEntries(result);

  return {
    title: meta.title,
    siteUrl: meta.siteUrl,
    entries,
  };
}
