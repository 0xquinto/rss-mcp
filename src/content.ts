import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export function extractContent(html: string): string | null {
  try {
    const { document } = parseHTML(html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new Readability(document as any);
    const article = reader.parse();
    return article?.textContent ?? null;
  } catch {
    return null;
  }
}

export async function fetchAndExtract(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RSS-MCP/1.0)",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    return extractContent(html);
  } catch {
    return null;
  }
}
