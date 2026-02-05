import { parseOpml as parseOpmlFeed } from "feedsmith";

export interface OPMLFeed {
  url: string;
  title?: string;
  siteUrl?: string;
}

interface OpmlOutline {
  xmlUrl?: string;
  text?: string;
  title?: string;
  htmlUrl?: string;
  outlines?: OpmlOutline[];
}

export function parseOpml(opmlText: string): OPMLFeed[] {
  const result = parseOpmlFeed(opmlText);
  const feeds: OPMLFeed[] = [];

  function extractFeeds(outlines: OpmlOutline[] | undefined) {
    if (!outlines) return;
    for (const outline of outlines) {
      if (outline.xmlUrl) {
        feeds.push({
          url: outline.xmlUrl,
          title: outline.text ?? outline.title,
          siteUrl: outline.htmlUrl,
        });
      }
      if (outline.outlines) {
        extractFeeds(outline.outlines);
      }
    }
  }

  extractFeeds(result.body?.outlines as OpmlOutline[] | undefined);
  return feeds;
}
