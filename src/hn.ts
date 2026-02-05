const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";

export interface HNScore {
  score: number;
  comments: number;
  hn_url: string;
}

interface HNSearchResponse {
  hits?: Array<{
    points?: number;
    num_comments?: number;
    objectID: string;
  }>;
}

export async function fetchHNScore(url: string): Promise<HNScore | null> {
  try {
    const searchUrl = new URL(HN_SEARCH_URL);
    searchUrl.searchParams.set("query", url);
    searchUrl.searchParams.set("restrictSearchableAttributes", "url");
    searchUrl.searchParams.set("hitsPerPage", "1");

    const response = await fetch(searchUrl.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as HNSearchResponse;
    const hits = data.hits ?? [];

    if (hits.length === 0) return null;

    const hit = hits[0];
    return {
      score: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      hn_url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    };
  } catch {
    return null;
  }
}
