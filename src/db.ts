import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DB_DIR = join(homedir(), ".rss-mcp");
const DB_PATH = join(DB_DIR, "rss.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    site_url TEXT,
    last_fetched TEXT,
    etag TEXT,
    last_modified TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    title TEXT,
    url TEXT,
    summary TEXT,
    content TEXT,
    author TEXT,
    published_at TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    is_read INTEGER DEFAULT 0,
    read_at TEXT,
    starred INTEGER DEFAULT 0,
    UNIQUE(feed_id, guid)
);

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
    title, summary, content,
    content='posts',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, title, summary, content)
    VALUES (new.id, new.title, new.summary, new.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, summary, content)
    VALUES ('delete', old.id, old.title, old.summary, old.content);
END;

CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, summary, content)
    VALUES ('delete', old.id, old.title, old.summary, old.content);
    INSERT INTO posts_fts(rowid, title, summary, content)
    VALUES (new.id, new.title, new.summary, new.content);
END;
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  return db;
}

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  last_fetched: string | null;
  etag: string | null;
  last_modified: string | null;
  created_at: string;
}

export interface Post {
  id: number;
  feed_id: number;
  guid: string;
  title: string | null;
  url: string | null;
  summary: string | null;
  content: string | null;
  author: string | null;
  published_at: string | null;
  fetched_at: string;
  is_read: number;
  read_at: string | null;
  starred: number;
  feed_title?: string;
  feed_url?: string;
}

export function addFeed(url: string, title?: string, siteUrl?: string): Feed {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO feeds (url, title, site_url) VALUES (?, ?, ?)",
  );
  const result = stmt.run(url, title ?? null, siteUrl ?? null);
  const feed = db
    .prepare("SELECT * FROM feeds WHERE id = ?")
    .get(result.lastInsertRowid) as Feed;
  return feed;
}

export function listFeeds(): Feed[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM feeds ORDER BY created_at DESC")
    .all() as Feed[];
}

export function removeFeed(feedId: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  return result.changes > 0;
}

export function getFeed(feedId: number): Feed | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId) as Feed) ?? null
  );
}

export function updateFeedMeta(
  feedId: number,
  title: string | null,
  siteUrl: string | null,
  etag: string | null,
  lastModified: string | null,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE feeds
     SET title = COALESCE(?, title),
         site_url = COALESCE(?, site_url),
         last_fetched = datetime('now'),
         etag = ?,
         last_modified = ?
     WHERE id = ?`,
  ).run(title, siteUrl, etag, lastModified, feedId);
}

export interface PostEntry {
  guid: string;
  title?: string;
  url?: string;
  summary?: string;
  author?: string;
  published_at?: string;
}

export function upsertPosts(feedId: number, entries: PostEntry[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO posts (feed_id, guid, title, url, summary, author, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let count = 0;
  const insertMany = db.transaction((entries: PostEntry[]) => {
    for (const e of entries) {
      const result = stmt.run(
        feedId,
        e.guid,
        e.title ?? null,
        e.url ?? null,
        e.summary ?? null,
        e.author ?? null,
        e.published_at ?? null,
      );
      if (result.changes > 0) count++;
    }
  });

  insertMany(entries);
  return count;
}

export interface GetPostsOptions {
  feedId?: number;
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  search?: string;
  since?: string;
}

export function getPosts(options: GetPostsOptions = {}): Post[] {
  const db = getDb();
  const {
    feedId,
    limit = 50,
    offset = 0,
    unreadOnly = false,
    search,
    since,
  } = options;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (feedId !== undefined) {
    conditions.push("p.feed_id = ?");
    params.push(feedId);
  }
  if (unreadOnly) {
    conditions.push("p.is_read = 0");
  }
  if (since) {
    conditions.push("p.published_at >= ?");
    params.push(since);
  }
  if (search) {
    conditions.push(
      "p.id IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ?)",
    );
    params.push(search);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT p.*, f.title as feed_title, f.url as feed_url
    FROM posts p
    JOIN feeds f ON p.feed_id = f.id
    ${whereClause}
    ORDER BY p.published_at DESC NULLS LAST
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);
  return db.prepare(query).all(...params) as Post[];
}

export function markRead(postIds: number[]): number {
  if (postIds.length === 0) return 0;
  const db = getDb();
  const placeholders = postIds.map(() => "?").join(",");
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE posts SET is_read = 1, read_at = ? WHERE id IN (${placeholders})`,
    )
    .run(now, ...postIds);
  return result.changes;
}

export function markUnread(postIds: number[]): number {
  if (postIds.length === 0) return 0;
  const db = getDb();
  const placeholders = postIds.map(() => "?").join(",");
  const result = db
    .prepare(
      `UPDATE posts SET is_read = 0, read_at = NULL WHERE id IN (${placeholders})`,
    )
    .run(...postIds);
  return result.changes;
}

export interface DigestPost {
  id: number;
  feed: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  published_at: string | null;
}

export function getDailyDigest(
  hours: number = 24,
  maxSummaryLength: number = 300,
): DigestPost[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      `SELECT p.id, f.title AS feed, p.title, p.summary, p.url, p.published_at
       FROM posts p JOIN feeds f ON p.feed_id = f.id
       WHERE p.published_at >= ?
       ORDER BY p.published_at DESC`,
    )
    .all(cutoff) as DigestPost[];

  return rows.map((row) => ({
    ...row,
    summary:
      row.summary && row.summary.length > maxSummaryLength
        ? row.summary.slice(0, maxSummaryLength) + "..."
        : row.summary,
  }));
}

const MAX_CONTENT_LENGTH = 5000;
const TRUNCATION_MARKER =
  "\n\n[Content truncated. Use full=true for complete article.]";

export function updatePostContent(postId: number, content: string): void {
  const db = getDb();
  db.prepare("UPDATE posts SET content = ? WHERE id = ?").run(content, postId);
}

export interface PostContent extends Post {
  truncated: boolean;
}

export function getPostContent(
  postId: number,
  full: boolean = false,
): PostContent | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*, f.title as feed_title
       FROM posts p JOIN feeds f ON p.feed_id = f.id
       WHERE p.id = ?`,
    )
    .get(postId) as Post | undefined;

  if (!row) return null;

  let content = row.content ?? "";
  let truncated = false;

  if (!full && content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + TRUNCATION_MARKER;
    truncated = true;
  }

  return { ...row, content, truncated };
}
