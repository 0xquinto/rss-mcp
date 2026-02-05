import { parseFeed as parseRssFeed } from "feedsmith";
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

interface FeedItem {
  id?: string;
  link?: string;
  title?: string;
  description?: string;
  content?: string;
  author?: { name?: string; email?: string } | string;
  published?: string | Date;
}

interface FeedData {
  title?: string;
  link?: string;
  items?: FeedItem[];
}

export function parseFeed(xml: string): ParsedFeed {
  const result = parseRssFeed(xml);
  const feed = result.feed as FeedData;

  const entries: PostEntry[] = (feed.items ?? []).map((item: FeedItem) => {
    let authorStr: string | undefined;
    if (typeof item.author === "string") {
      authorStr = item.author;
    } else if (item.author) {
      authorStr = item.author.name ?? item.author.email;
    }

    return {
      guid: item.id ?? item.link ?? "",
      title: item.title,
      url: item.link,
      summary: item.description ?? item.content,
      author: authorStr,
      published_at: item.published
        ? new Date(item.published).toISOString()
        : undefined,
    };
  });

  return {
    title: feed.title ?? null,
    siteUrl: feed.link ?? null,
    entries,
  };
}
