/**
 * Transcript Extractor
 *
 * Extracts text content from URLs for thesis extraction.
 * YouTube: uses yt-dlp for auto-captions.
 * X/Twitter: uses X API v2 (with note_tweet for long posts), falls back to
 *            fxtwitter.com (free, no auth) if no X_BEARER_TOKEN is set.
 * Other URLs: markdown.new → raw fetch + HTML strip.
 *
 * Usage:
 *   bun run skill/scripts/extract.ts "https://youtube.com/watch?v=xxx"
 *   bun run skill/scripts/extract.ts "https://x.com/user/status/123"
 *   bun run skill/scripts/extract.ts "https://example.com/article"
 *
 * Requires: yt-dlp (brew install yt-dlp) for YouTube
 * Optional: X_BEARER_TOKEN env var for X API (better rate limits, higher reliability)
 * Optional: X_WEB_BEARER_TOKEN env var for linked X article extraction
 */

import { $ } from "bun";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getRuntimeSourceDir, readEnvValue } from "./runtime-paths";

// ---------------------------------------------------------------------------
// X API tokens (optional)
// ---------------------------------------------------------------------------

function loadEnvToken(key: string): string | undefined {
  return readEnvValue(key);
}
const X_BEARER_TOKEN = loadEnvToken("X_BEARER_TOKEN");
const X_WEB_BEARER_TOKEN = loadEnvToken("X_WEB_BEARER_TOKEN");
let cachedDiscoveredXWebBearerToken: string | null | undefined;

async function discoverXWebBearerToken(): Promise<string | null> {
  if (cachedDiscoveredXWebBearerToken !== undefined) {
    return cachedDiscoveredXWebBearerToken;
  }

  try {
    const homeRes = await fetch("https://x.com", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!homeRes.ok) {
      cachedDiscoveredXWebBearerToken = null;
      return null;
    }

    const homeHtml = await homeRes.text();
    const mainBundleUrl = homeHtml.match(
      /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js/i,
    )?.[0];
    if (!mainBundleUrl) {
      cachedDiscoveredXWebBearerToken = null;
      return null;
    }

    const bundleRes = await fetch(mainBundleUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://x.com/",
      },
    });
    if (!bundleRes.ok) {
      cachedDiscoveredXWebBearerToken = null;
      return null;
    }

    const bundleJs = await bundleRes.text();
    const discoveredToken = bundleJs.match(/AAAAAA[A-Za-z0-9%]{80,}/)?.[0]?.trim();
    if (!discoveredToken) {
      cachedDiscoveredXWebBearerToken = null;
      return null;
    }

    cachedDiscoveredXWebBearerToken = discoveredToken;
    return discoveredToken;
  } catch {
    cachedDiscoveredXWebBearerToken = null;
    return null;
  }
}

interface XArticleExtraction {
  article_url: string;
  article_rest_id: string;
  article_title?: string;
  article_word_count: number;
  article_text: string;
}

function collectArticleTextFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const maybeText = (block as { text?: unknown }).text;
      return typeof maybeText === "string" ? maybeText.trim() : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function extractXArticleFromTweetGraphql(tweetId: string): Promise<XArticleExtraction | null> {
  const webBearerToken = X_WEB_BEARER_TOKEN ?? (await discoverXWebBearerToken()) ?? X_BEARER_TOKEN;
  if (!webBearerToken) return null;

  try {
    const guestActivateRes = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${webBearerToken}`,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!guestActivateRes.ok) return null;

    const guestJson = (await guestActivateRes.json()) as { guest_token?: string };
    const guestToken = guestJson.guest_token?.trim();
    if (!guestToken) return null;

    const queryId = "oSBAzPwnB3u5R9KqxACO3Q";
    const operation = "TweetResultByRestId";

    const variables = {
      tweetId,
      withCommunity: true,
      includePromotedContent: false,
      withVoice: false,
    };
    const features = {
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_enhance_cards_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      view_counts_everywhere_api_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
    };
    const fieldToggles = {
      withArticleRichContentState: true,
      withArticlePlainText: true,
      withAuxiliaryUserLabels: false,
      withGrokAnalyze: false,
      withDisallowedReplyControls: false,
    };

    const graphqlUrl = new URL(`https://x.com/i/api/graphql/${queryId}/${operation}`);
    graphqlUrl.searchParams.set("variables", JSON.stringify(variables));
    graphqlUrl.searchParams.set("features", JSON.stringify(features));
    graphqlUrl.searchParams.set("fieldToggles", JSON.stringify(fieldToggles));

    const gqlRes = await fetch(graphqlUrl, {
      headers: {
        Authorization: `Bearer ${webBearerToken}`,
        "x-guest-token": guestToken,
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
        "User-Agent": "Mozilla/5.0",
        Referer: `https://x.com/i/web/status/${tweetId}`,
      },
    });
    if (!gqlRes.ok) return null;

    const gqlJson = (await gqlRes.json()) as {
      data?: {
        tweetResult?: {
          result?: {
            article?: {
              article_results?: {
                result?: {
                  rest_id?: string;
                  title?: string;
                  plain_text?: string;
                  content_state?: {
                    blocks?: Array<{ text?: string }>;
                  };
                };
              };
            };
          };
        };
      };
    };

    const article = gqlJson.data?.tweetResult?.result?.article?.article_results?.result;
    if (!article) return null;

    const articleRestId = typeof article.rest_id === "string" ? article.rest_id.trim() : "";
    if (!articleRestId) return null;

    const plainText = typeof article.plain_text === "string" ? article.plain_text.trim() : "";
    const blockText = collectArticleTextFromBlocks(article.content_state?.blocks);
    const articleText = plainText || blockText;
    if (!articleText) return null;

    const articleWordCount = articleText.split(/\s+/).filter(Boolean).length;
    const articleTitle = typeof article.title === "string" && article.title.trim() ? article.title.trim() : undefined;

    return {
      article_url: `https://x.com/i/article/${articleRestId}`,
      article_rest_id: articleRestId,
      article_title: articleTitle,
      article_word_count: articleWordCount,
      article_text: articleText,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL classification
// ---------------------------------------------------------------------------

type UrlType = "youtube" | "tweet" | "text";

function classifyUrl(url: string): UrlType {
  const u = url.toLowerCase();
  if (
    u.includes("youtube.com/watch") ||
    u.includes("youtu.be/") ||
    u.includes("youtube.com/live")
  )
    return "youtube";
  if (
    u.includes("x.com/") && u.includes("/status/") ||
    u.includes("twitter.com/") && u.includes("/status/")
  )
    return "tweet";
  return "text";
}

/** Extract tweet ID and handle from an x.com or twitter.com URL */
function parseTweetUrl(url: string): { handle: string; tweetId: string } | null {
  const m = url.match(/(?:x|twitter)\.com\/(\w+)\/status\/(\d+)/);
  if (!m) return null;
  return { handle: m[1], tweetId: m[2] };
}

function extractVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([^&]+)/) ||
    url.match(/youtu\.be\/([^?&]+)/) ||
    url.match(/youtube\.com\/live\/([^?&]+)/);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// YouTube transcript via yt-dlp
// ---------------------------------------------------------------------------

type YoutubeError =
  | { error_type: "yt_dlp_not_installed"; message: string; fix: string }
  | { error_type: "no_captions"; message: string; alternatives: string[] }
  | { error_type: "unavailable"; message: string; reason: string; alternatives: string[] }
  | { error_type: "unknown"; message: string; stderr: string };

async function checkYtDlp(): Promise<boolean> {
  const result = await $`which yt-dlp`.quiet().nothrow();
  return result.exitCode === 0;
}

interface YoutubeMeta {
  publishedAt: string | null;
  title: string | null;
  /** YouTube channel display name (e.g. "All-In Podcast") */
  channel: string | null;
  /** YouTube @handle (e.g. "allin") — without the @ prefix */
  channelHandle: string | null;
  /** Full channel URL (e.g. "https://www.youtube.com/@allin") */
  channelUrl: string | null;
  /** Video description (first 1500 chars — contains guest lists, timestamps, links) */
  description: string | null;
  /** Duration in seconds */
  durationSeconds: number | null;
}

/** Fetch YouTube video metadata via yt-dlp --dump-json */
async function fetchYoutubeMeta(url: string): Promise<YoutubeMeta> {
  const empty: YoutubeMeta = { publishedAt: null, title: null, channel: null, channelHandle: null, channelUrl: null, description: null, durationSeconds: null };
  try {
    const result = await $`yt-dlp --dump-json --skip-download ${url}`.quiet().nothrow();
    if (result.exitCode !== 0) return empty;
    const meta = JSON.parse(result.stdout.toString());

    const title: string | null = meta.title ?? meta.fulltitle ?? null;

    // yt-dlp returns `timestamp` as Unix epoch seconds (full precision)
    let publishedAt: string | null = null;
    if (meta.timestamp) {
      publishedAt = new Date(meta.timestamp * 1000).toISOString();
    } else if (meta.upload_date) {
      const d = meta.upload_date;
      publishedAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    }

    // Channel info: uploader_id is the @handle (e.g. "@allin"), channel is display name
    const channel: string | null = meta.channel ?? meta.uploader ?? null;
    const rawHandle: string | null = meta.uploader_id ?? null;
    // Strip leading @ if present (yt-dlp returns "@allin")
    const channelHandle = rawHandle?.replace(/^@/, "") ?? null;
    const channelUrl: string | null = meta.uploader_url ?? meta.channel_url ?? null;
    const durationSeconds: number | null = meta.duration ?? null;
    // First 1500 chars of description — enough for guest lists, timestamps, links
    const description: string | null = meta.description?.slice(0, 1500) ?? null;

    if (channel) console.error(`[transcript] YouTube channel: ${channel} (@${channelHandle})`);

    return { publishedAt, title, channel, channelHandle, channelUrl, description, durationSeconds };
  } catch {
    return empty;
  }
}

/** Push a streaming event if context exists. Fire-and-forget. */
async function streamStatus(message: string): Promise<void> {
  try {
    const { getStreamContext, pushEvent } = await import("./stream-context");
    const ctx = getStreamContext();
    if (ctx) pushEvent(ctx.source_id, "status", { message });
  } catch { /* streaming is optional */ }
}

async function extractYoutube(url: string): Promise<string> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Could not extract video ID from URL");

  // Step 1: check yt-dlp is installed before attempting anything
  const installed = await checkYtDlp();
  if (!installed) {
    const err: YoutubeError = {
      error_type: "yt_dlp_not_installed",
      message: "yt-dlp is not installed. YouTube transcription requires it.",
      fix: "Install with: brew install yt-dlp  (then retry)",
    };
    return JSON.stringify({ source: "youtube", url, ...err });
  }

  streamStatus("Downloading transcript...");

  const outTemplate = join(tmpdir(), `yt-transcript-${videoId}-%(id)s`);
  const capFile = join(tmpdir(), `yt-transcript-${videoId}-${videoId}.en.json3`);

  // Step 2: attempt caption download — quiet captures stderr for diagnosis
  const result = await $`yt-dlp --write-auto-sub --write-sub --skip-download --sub-lang en --sub-format json3 -o ${outTemplate} ${url}`
    .quiet()
    .nothrow();

  const stderr = result.stderr.toString();
  const capExists = await Bun.file(capFile).exists();

  if (!capExists) {
    // Diagnose why: private/unavailable vs. simply no captions
    const isUnavailable =
      stderr.includes("Private video") ||
      stderr.includes("Video unavailable") ||
      stderr.includes("This video is unavailable") ||
      stderr.includes("members-only") ||
      stderr.includes("Sign in to confirm your age") ||
      stderr.includes("HTTP Error 403") ||
      stderr.includes("HTTP Error 404") ||
      stderr.includes("is not available");

    const hasNoCaptions =
      stderr.includes("no subtitles") ||
      stderr.includes("There are no subtitles") ||
      stderr.includes("--write-subs didn't match") ||
      result.exitCode === 0; // yt-dlp succeeded but no caption file = no captions exist

    if (isUnavailable) {
      const err: YoutubeError = {
        error_type: "unavailable",
        message: "Video unavailable — may be private, deleted, members-only, or age-restricted.",
        reason: stderr.split("\n").find(l => l.includes("ERROR"))?.trim() ?? "Access restricted",
        alternatives: [
          "Paste the transcript manually (YouTube → ... → Open transcript → copy text)",
          "If you have a Gemini API key, use diarize.ts for speaker-labeled transcription",
        ],
      };
      return JSON.stringify({ source: "youtube", url, ...err });
    }

    if (hasNoCaptions) {
      const err: YoutubeError = {
        error_type: "no_captions",
        message: "This video has no auto-generated or manual English captions.",
        alternatives: [
          "Paste the transcript manually (YouTube → ... → Open transcript → copy all text)",
          "If you have a Gemini API key set, use diarize.ts — it works without captions (uploads audio directly)",
        ],
      };
      return JSON.stringify({ source: "youtube", url, ...err });
    }

    // Fallback: something else went wrong
    const err: YoutubeError = {
      error_type: "unknown",
      message: "yt-dlp ran but no caption file was produced.",
      stderr: stderr.slice(0, 500),
    };
    return JSON.stringify({ source: "youtube", url, ...err });
  }

  // Step 3: fetch metadata (parallel-safe, runs while we parse captions)
  const metaPromise = fetchYoutubeMeta(url);

  // Step 4: parse the caption file
  const data = (await Bun.file(capFile).json()) as {
    events?: Array<{ segs?: Array<{ utf8: string }> }>;
  };

  const text =
    data.events
      ?.filter((e) => e.segs)
      .map((e) => e.segs!.map((s) => s.utf8).join(""))
      .join(" ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? "";

  await $`rm -f ${capFile}`.quiet().nothrow();

  const wordCount = text.split(/\s+/).length;
  const ytMeta = await metaPromise;
  if (ytMeta.publishedAt) console.error(`[transcript] YouTube published_at: ${ytMeta.publishedAt}`);
  if (ytMeta.title) console.error(`[transcript] YouTube title: ${ytMeta.title}`);

  const channelLabel = ytMeta.channel ?? "video";
  streamStatus(`${wordCount.toLocaleString()} words from ${channelLabel}`);

  return JSON.stringify({
    source: "youtube",
    url,
    word_count: wordCount,
    transcript: text,
    ...(ytMeta.title ? { title: ytMeta.title } : {}),
    ...(ytMeta.publishedAt ? { published_at: ytMeta.publishedAt } : {}),
    ...(ytMeta.channel ? { channel: ytMeta.channel } : {}),
    ...(ytMeta.channelHandle ? { channel_handle: ytMeta.channelHandle } : {}),
    ...(ytMeta.channelUrl ? { channel_url: ytMeta.channelUrl } : {}),
    ...(ytMeta.durationSeconds ? { duration_seconds: ytMeta.durationSeconds } : {}),
    ...(ytMeta.description ? { description: ytMeta.description } : {}),
  });
}

// ---------------------------------------------------------------------------
// Tweet extraction — tiered: X API v2 → fxtwitter → vxtwitter
// ---------------------------------------------------------------------------

/** Fetch a single tweet via X API v2 (requires X_BEARER_TOKEN) */
async function extractTweetViaApi(tweetId: string, handle: string): Promise<string | null> {
  if (!X_BEARER_TOKEN) return null;

  const params = new URLSearchParams({
    "tweet.fields": "created_at,public_metrics,note_tweet,author_id,entities,attachments,referenced_tweets",
    expansions: "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id",
    "user.fields": "username,name",
    "media.fields": "url,preview_image_url,type,alt_text",
  });

  const url = `https://api.x.com/2/tweets/${tweetId}?${params}`;
  console.error(`[transcript] Trying X API v2 for tweet ${tweetId}...`);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
    });

    if (!res.ok) {
      console.error(`[transcript] X API returned ${res.status}, falling back`);
      return null;
    }

    const data = await res.json() as {
      data?: {
        id: string;
        text: string;
        created_at: string;
        author_id: string;
        note_tweet?: { text: string };
        entities?: {
          urls?: Array<{
            expanded_url?: string;
            unwound_url?: string;
          }>;
        };
        public_metrics?: {
          like_count: number;
          retweet_count: number;
          reply_count: number;
          impression_count: number;
        };
        referenced_tweets?: Array<{ type: string; id: string }>;
      };
      includes?: {
        users?: Array<{ id?: string; username: string; name: string }>;
        media?: Array<{ type: string; url?: string; preview_image_url?: string; alt_text?: string }>;
        tweets?: Array<{ id: string; text: string; author_id?: string; note_tweet?: { text: string } }>;
      };
    };

    if (!data.data) return null;

    const t = data.data;
    // Long tweets store full text in note_tweet.text; text field is truncated to ~280 chars
    const fullText = t.note_tweet?.text ?? t.text;
    const username = data.includes?.users?.[0]?.username ?? handle;
    const isLongTweet = !!t.note_tweet;

    if (isLongTweet) {
      console.error(`[transcript] Long tweet detected (note_tweet), got ${fullText.length} chars (text field was ${t.text.length} chars)`);
    }

    // Extract media (images, videos)
    const media = data.includes?.media
      ?.filter(m => m.type === "photo" || m.type === "animated_gif")
      .map(m => ({
        url: m.url ?? m.preview_image_url ?? "",
        alt: m.alt_text ?? "",
        type: m.type,
      }))
      .filter(m => m.url) ?? [];

    if (media.length) {
      console.error(`[transcript] Tweet has ${media.length} image(s)`);
    }

    const articleUrlFromEntity = t.entities?.urls
      ?.map((u) => (typeof u.expanded_url === "string" ? u.expanded_url : u.unwound_url))
      .find((u): u is string => typeof u === "string" && /(?:x|twitter)\.com\/i\/article\/\d+/i.test(u));

    let extractedArticle: XArticleExtraction | null = null;
    let effectiveText = fullText;
    if (articleUrlFromEntity) {
      streamStatus("Tweet links to an X article. Pulling full article text...");
      extractedArticle = await extractXArticleFromTweetGraphql(tweetId);
      if (extractedArticle?.article_text) {
        effectiveText = extractedArticle.article_text;
        console.error(
          `[transcript] Resolved linked X article ${extractedArticle.article_rest_id} (${extractedArticle.article_word_count} words)`,
        );
      } else {
        console.error("[transcript] Could not resolve linked X article payload, using tweet text");
      }
    }

    const effectiveWordCount = effectiveText.split(/\s+/).filter(Boolean).length;

    // Extract quoted tweet if present
    const quotedRef = t.referenced_tweets?.find(r => r.type === "quoted");
    const quotedTweet = quotedRef ? data.includes?.tweets?.find(qt => qt.id === quotedRef.id) : null;
    const quotedAuthor = quotedTweet?.author_id
      ? data.includes?.users?.find(u => u.id === quotedTweet.author_id)
      : null;

    return JSON.stringify({
      source: extractedArticle ? "x_api_article" : "x_api",
      url: `https://x.com/${username}/status/${tweetId}`,
      author: username,
      author_name: data.includes?.users?.[0]?.name,
      created_at: t.created_at,
      published_at: t.created_at,
      text: effectiveText,
      word_count: effectiveWordCount,
      is_long_tweet: isLongTweet,
      ...(extractedArticle
        ? {
            tweet_text: fullText,
            article_url: extractedArticle.article_url,
            article_rest_id: extractedArticle.article_rest_id,
            article_word_count: extractedArticle.article_word_count,
            ...(extractedArticle.article_title ? { article_title: extractedArticle.article_title } : {}),
          }
        : {}),
      ...(quotedTweet ? { quoted_tweet: { author: quotedAuthor?.username ?? "unknown", text: quotedTweet.note_tweet?.text ?? quotedTweet.text } } : {}),
      likes: t.public_metrics?.like_count ?? 0,
      retweets: t.public_metrics?.retweet_count ?? 0,
      replies: t.public_metrics?.reply_count ?? 0,
      impressions: t.public_metrics?.impression_count ?? 0,
      ...(media.length > 0 ? { images: media } : {}),
    });
  } catch (err: any) {
    console.error(`[transcript] X API error: ${err.message}, falling back`);
    return null;
  }
}

/** Fetch a single tweet via fxtwitter (free, no auth, handles long tweets) */
async function extractTweetViaFxTwitter(tweetId: string, handle: string): Promise<string | null> {
  const url = `https://api.fxtwitter.com/${handle}/status/${tweetId}`;
  console.error(`[transcript] Trying fxtwitter for tweet ${tweetId}...`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[transcript] fxtwitter returned ${res.status}, falling back`);
      return null;
    }

    const data = await res.json() as {
      code?: number;
      tweet?: {
        text: string;
        created_at: string;
        author: { screen_name: string; name: string; avatar_url?: string };
        likes: number;
        retweets: number;
        replies: number;
        views: number;
        is_note_tweet?: boolean;
        media?: {
          photos?: Array<{ url: string; altText?: string }>;
        };
        quote?: {
          text: string;
          author: { screen_name: string; name: string };
        };
      };
    };

    if (!data.tweet) return null;

    const t = data.tweet;
    console.error(`[transcript] fxtwitter: ${t.text.length} chars, ${t.is_note_tweet ? "long tweet" : "standard"}`);

    // Extract photos from fxtwitter media
    const media = t.media?.photos?.map(p => ({
      url: p.url,
      alt: p.altText ?? "",
      type: "photo",
    })) ?? [];

    if (media.length) {
      console.error(`[transcript] Tweet has ${media.length} image(s)`);
    }

    // fxtwitter created_at format varies; normalize to ISO 8601
    const fxPublishedAt = t.created_at ? new Date(t.created_at).toISOString() : undefined;
    const articleUrlFromText = t.text.match(/https?:\/\/(?:x|twitter)\.com\/i\/article\/\d+/i)?.[0];
    let extractedArticle: XArticleExtraction | null = null;
    let effectiveText = t.text;
    if (articleUrlFromText) {
      streamStatus("Tweet links to an X article. Pulling full article text...");
      extractedArticle = await extractXArticleFromTweetGraphql(tweetId);
      if (extractedArticle?.article_text) {
        effectiveText = extractedArticle.article_text;
        console.error(
          `[transcript] Resolved linked X article ${extractedArticle.article_rest_id} (${extractedArticle.article_word_count} words)`,
        );
      }
    }
    const effectiveWordCount = effectiveText.split(/\s+/).filter(Boolean).length;

    // Capture avatar URL and upgrade to 400x400 for high-quality profile pictures
    const authorAvatarUrl = t.author.avatar_url
      ? t.author.avatar_url.replace(/_normal\./, "_400x400.")
      : undefined;

    return JSON.stringify({
      source: extractedArticle ? "fxtwitter_article" : "fxtwitter",
      url: `https://x.com/${t.author.screen_name}/status/${tweetId}`,
      author: t.author.screen_name,
      author_name: t.author.name,
      ...(authorAvatarUrl ? { author_avatar_url: authorAvatarUrl } : {}),
      created_at: t.created_at,
      ...(fxPublishedAt ? { published_at: fxPublishedAt } : {}),
      text: effectiveText,
      word_count: effectiveWordCount,
      is_long_tweet: !!t.is_note_tweet,
      ...(extractedArticle
        ? {
            tweet_text: t.text,
            article_url: extractedArticle.article_url,
            article_rest_id: extractedArticle.article_rest_id,
            article_word_count: extractedArticle.article_word_count,
            ...(extractedArticle.article_title ? { article_title: extractedArticle.article_title } : {}),
          }
        : {}),
      ...(t.quote ? { quoted_tweet: { author: t.quote.author.screen_name, text: t.quote.text } } : {}),
      likes: t.likes ?? 0,
      retweets: t.retweets ?? 0,
      replies: t.replies ?? 0,
      impressions: t.views ?? 0,
      ...(media.length > 0 ? { images: media } : {}),
    });
  } catch (err: any) {
    console.error(`[transcript] fxtwitter error: ${err.message}, falling back`);
    return null;
  }
}

/** Fetch a single tweet via vxtwitter (backup for fxtwitter) */
async function extractTweetViaVxTwitter(tweetId: string, handle: string): Promise<string | null> {
  const url = `https://api.vxtwitter.com/${handle}/status/${tweetId}`;
  console.error(`[transcript] Trying vxtwitter for tweet ${tweetId}...`);

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json() as {
      text?: string;
      user_name?: string;
      user_screen_name?: string;
      date?: string;
      likes?: number;
      retweets?: number;
      replies?: number;
      views?: number;
    };

    if (!data.text) return null;

    console.error(`[transcript] vxtwitter: ${data.text.length} chars`);

    const vxPublishedAt = data.date ? new Date(data.date).toISOString() : undefined;

    return JSON.stringify({
      source: "vxtwitter",
      url: `https://x.com/${data.user_screen_name ?? handle}/status/${tweetId}`,
      author: data.user_screen_name ?? handle,
      author_name: data.user_name,
      created_at: data.date,
      ...(vxPublishedAt ? { published_at: vxPublishedAt } : {}),
      text: data.text,
      word_count: data.text.split(/\s+/).length,
      likes: data.likes ?? 0,
      retweets: data.retweets ?? 0,
      replies: data.replies ?? 0,
      impressions: data.views ?? 0,
    });
  } catch (err: any) {
    console.error(`[transcript] vxtwitter error: ${err.message}`);
    return null;
  }
}

/**
 * Extract tweet content with tiered fallback:
 *   1. X API v2 (if X_BEARER_TOKEN set) — most reliable, handles note_tweet
 *   2. fxtwitter.com — free, no auth, handles long tweets
 *   3. vxtwitter.com — backup for fxtwitter
 *   4. Error with setup instructions
 */
async function extractTweet(url: string): Promise<string> {
  const parsed = parseTweetUrl(url);
  if (!parsed) {
    return JSON.stringify({ source: "tweet", url, error: "Could not parse tweet URL" });
  }

  const { handle, tweetId } = parsed;
  streamStatus(`Fetching tweet from @${handle}...`);

  // Tier 1: X API (if token available)
  const apiResult = await extractTweetViaApi(tweetId, handle);
  if (apiResult) return apiResult;

  // Tier 2: fxtwitter (free, no auth)
  const fxResult = await extractTweetViaFxTwitter(tweetId, handle);
  if (fxResult) return fxResult;

  // Tier 3: vxtwitter (backup)
  const vxResult = await extractTweetViaVxTwitter(tweetId, handle);
  if (vxResult) return vxResult;

  // All tiers failed
  const hasToken = !!X_BEARER_TOKEN;
  const hint = hasToken
    ? "All extraction methods failed. The tweet may be deleted or from a private account. Ask user to paste the text or a screenshot."
    : "Tweet extraction failed. For best results, add X_BEARER_TOKEN to .env (see developer.x.com, pay-per-use, no monthly fee). Or paste the tweet text / screenshot directly.";

  return JSON.stringify({ source: "tweet", url, error: hint });
}

// ---------------------------------------------------------------------------
// Image extraction helpers
// ---------------------------------------------------------------------------

interface ExtractedImage {
  url: string;
  alt: string;
  context: string;
}

interface ArticleMetadata {
  title?: string;
  published_at?: string;
  author?: string;
  author_handle?: string;
  author_platform?: string;
  author_url?: string;
  source_images?: string[];
}

/** Extract image URLs from HTML, filtering noise (tracking pixels, icons, logos) */
function extractImagesFromHtml(html: string, baseUrl: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const imgRegex = /<img[^>]+>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const src = tag.match(/src=["']([^"']+)["']/)?.[1];
    const alt = tag.match(/alt=["']([^"']*?)["']/)?.[1] ?? "";

    if (!src) continue;

    // Skip noise: tracking pixels, spacers, favicons, small icons
    const lower = src.toLowerCase();
    if (lower.includes("tracking") || lower.includes("pixel") ||
        lower.includes("spacer") || lower.includes("favicon") ||
        lower.includes("logo") || lower.includes("icon") ||
        lower.includes("avatar") || lower.includes("profile_images") ||
        lower.includes("emoji") || lower.includes("badge")) continue;

    // Skip tiny images (likely icons)
    const width = tag.match(/width=["']?(\d+)/)?.[1];
    const height = tag.match(/height=["']?(\d+)/)?.[1];
    if (width && parseInt(width) < 50) continue;
    if (height && parseInt(height) < 50) continue;

    // Resolve relative URLs
    let fullUrl = src;
    try { fullUrl = new URL(src, baseUrl).href; } catch {}

    // Get surrounding text for context
    const pos = match.index;
    const before = html.slice(Math.max(0, pos - 300), pos)
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const after = html.slice(pos + tag.length, pos + tag.length + 300)
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const context = `${before.slice(-100)} [...] ${after.slice(0, 100)}`.trim();

    images.push({ url: fullUrl, alt, context });
  }

  return images;
}

/** Extract image URLs from markdown ![alt](url) syntax */
function extractImagesFromMarkdown(md: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;

  while ((match = mdImgRegex.exec(md)) !== null) {
    const alt = match[1];
    const url = match[2];
    const lower = url.toLowerCase();
    if (lower.includes("tracking") || lower.includes("pixel") ||
        lower.includes("spacer") || lower.includes("favicon") ||
        lower.includes("emoji") || lower.includes("badge")) continue;

    // Get surrounding text for context
    const pos = match.index;
    const before = md.slice(Math.max(0, pos - 200), pos).trim();
    const after = md.slice(pos + match[0].length, pos + match[0].length + 200).trim();
    const context = `${before.slice(-100)} [...] ${after.slice(0, 100)}`.trim();

    images.push({ url, alt, context });
  }

  return images;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function uniqueUrls(values: Array<string | null | undefined>, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const absolute = new URL(trimmed, baseUrl).href;
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      out.push(absolute);
    } catch {
      // ignore malformed URLs
    }
  }
  return out;
}

function extractProfileHandle(profileUrl: string): { handle: string; platform: string; profile_url: string } | null {
  try {
    const parsed = new URL(profileUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const first = pathParts[0] ?? "";

    if (host === "x.com" || host === "twitter.com") {
      if (!first || first === "i" || first === "home" || first === "search" || first === "explore") return null;
      if (first.startsWith("@")) return { handle: first.slice(1), platform: "x", profile_url: parsed.href };
      return { handle: first, platform: "x", profile_url: parsed.href };
    }

    if (host.includes("youtube.com")) {
      if (!first) return null;
      if (first.startsWith("@")) return { handle: first.slice(1), platform: "youtube", profile_url: parsed.href };
      if (first === "channel" && pathParts[1]) {
        return { handle: pathParts[1], platform: "youtube", profile_url: parsed.href };
      }
      return null;
    }

    if (host.endsWith(".substack.com")) {
      const handle = host.slice(0, -".substack.com".length);
      return handle ? { handle, platform: "substack", profile_url: parsed.href } : null;
    }
  } catch {
    return null;
  }
  return null;
}

function collectJsonLdObjects(html: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      objects.push(record);
      const graph = record["@graph"];
      if (Array.isArray(graph)) queue.push(...graph);
    }
  }
  return objects;
}

function extractMetaMap(html: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (!content) continue;
    const value = compactWhitespace(decodeHtmlEntities(content));
    if (!value) continue;
    for (const keyType of ["name", "property", "itemprop"] as const) {
      const key = tag.match(new RegExp(`\\b${keyType}=["']([^"']+)["']`, "i"))?.[1]?.toLowerCase();
      if (!key) continue;
      const existing = map.get(key) ?? [];
      existing.push(value);
      map.set(key, existing);
    }
  }
  return map;
}

function firstMeta(meta: Map<string, string[]>, keys: string[]): string | null {
  for (const key of keys) {
    const values = meta.get(key.toLowerCase());
    if (!values || values.length === 0) continue;
    for (const value of values) {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function pickMarkdownTitle(md: string): string | null {
  const lines = md.split(/\r?\n/);
  for (const rawLine of lines.slice(0, 30)) {
    const line = compactWhitespace(rawLine.replace(/^#+\s*/, ""));
    if (!line) continue;
    if (line.length < 6) continue;
    if (line.startsWith("![")) continue;
    return line.slice(0, 220);
  }
  return null;
}

function extractArticleMetadataFromHtml(
  html: string,
  baseUrl: string,
  markdownText?: string,
  images?: ExtractedImage[],
): ArticleMetadata {
  const meta = extractMetaMap(html);
  const ld = collectJsonLdObjects(html);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const timeTag = html.match(/<time[^>]*\bdatetime=["']([^"']+)["']/i)?.[1] ?? null;

  let ldTitle: string | null = null;
  let ldDate: string | null = null;
  let ldAuthor: string | null = null;
  let ldAuthorUrl: string | null = null;
  const ldImages: string[] = [];

  for (const record of ld) {
    const rawType = record["@type"];
    const types = Array.isArray(rawType)
      ? rawType.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase())
      : (typeof rawType === "string" ? [rawType.toLowerCase()] : []);

    const isArticleish = types.some((t) =>
      t.includes("article") || t.includes("posting") || t.includes("report") || t.includes("news"));
    if (!isArticleish && types.length > 0) continue;

    const headline = typeof record.headline === "string" ? compactWhitespace(record.headline) : null;
    const name = typeof record.name === "string" ? compactWhitespace(record.name) : null;
    if (!ldTitle) ldTitle = headline || name || null;

    const published = normalizeIsoDate(record.datePublished) ?? normalizeIsoDate(record.dateCreated) ?? normalizeIsoDate(record.dateModified);
    if (!ldDate && published) ldDate = published;

    const authorValue = record.author;
    const authorList = Array.isArray(authorValue) ? authorValue : [authorValue];
    for (const authorEntry of authorList) {
      if (typeof authorEntry === "string") {
        if (!ldAuthor) ldAuthor = compactWhitespace(authorEntry);
        continue;
      }
      if (!authorEntry || typeof authorEntry !== "object") continue;
      const authorObj = authorEntry as Record<string, unknown>;
      const authorName = typeof authorObj.name === "string" ? compactWhitespace(authorObj.name) : null;
      if (!ldAuthor && authorName) ldAuthor = authorName;
      const authorUrl = typeof authorObj.url === "string"
        ? authorObj.url
        : (typeof authorObj.sameAs === "string" ? authorObj.sameAs : null);
      if (!ldAuthorUrl && authorUrl) ldAuthorUrl = authorUrl;
    }

    const imageValue = record.image;
    const imageList = Array.isArray(imageValue) ? imageValue : [imageValue];
    for (const imageEntry of imageList) {
      if (typeof imageEntry === "string") {
        ldImages.push(imageEntry);
        continue;
      }
      if (!imageEntry || typeof imageEntry !== "object") continue;
      const imageObj = imageEntry as Record<string, unknown>;
      if (typeof imageObj.url === "string") ldImages.push(imageObj.url);
    }
  }

  const title = firstMeta(meta, ["og:title", "twitter:title", "parsely-title", "title"])
    ?? (titleTag ? compactWhitespace(decodeHtmlEntities(titleTag)) : null)
    ?? ldTitle
    ?? (markdownText ? pickMarkdownTitle(markdownText) : null);

  const publishedAt = normalizeIsoDate(firstMeta(meta, [
    "article:published_time",
    "og:published_time",
    "parsely-pub-date",
    "publish_date",
    "pubdate",
    "date",
    "dc.date",
    "dc.date.issued",
  ]))
    ?? normalizeIsoDate(timeTag)
    ?? ldDate;

  const author = firstMeta(meta, ["author", "article:author", "parsely-author"])
    ?? ldAuthor;
  const authorUrl = ldAuthorUrl;

  let authorHandle = firstMeta(meta, ["twitter:creator", "x:creator"]);
  if (authorHandle?.startsWith("@")) authorHandle = authorHandle.slice(1);
  let authorPlatform: string | undefined = authorHandle ? "x" : undefined;
  let resolvedAuthorUrl = authorUrl ?? undefined;

  if (!authorHandle && authorUrl) {
    const extracted = extractProfileHandle(authorUrl);
    if (extracted) {
      authorHandle = extracted.handle;
      authorPlatform = extracted.platform;
      resolvedAuthorUrl = extracted.profile_url;
    }
  }

  const sourceImages = uniqueUrls([
    ...ldImages,
    firstMeta(meta, ["og:image", "twitter:image", "twitter:image:src"]),
    ...(images ?? []).map((image) => image.url),
  ], baseUrl);

  return {
    ...(title ? { title } : {}),
    ...(publishedAt ? { published_at: publishedAt } : {}),
    ...(author ? { author } : {}),
    ...(authorHandle ? { author_handle: authorHandle } : {}),
    ...(authorPlatform ? { author_platform: authorPlatform } : {}),
    ...(resolvedAuthorUrl ? { author_url: resolvedAuthorUrl } : {}),
    ...(sourceImages.length > 0 ? { source_images: sourceImages } : {}),
  };
}

async function fetchArticleMetadata(url: string): Promise<ArticleMetadata | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (!body || body.length < 50) return null;
    const looksLikeHtml = /<html|<meta|<title|<script/i.test(body);
    if (!looksLikeHtml) return null;
    return extractArticleMetadataFromHtml(body, url);
  } catch {
    return null;
  }
}

function buildArticlePayload(
  source: "markdown.new" | "text",
  url: string,
  text: string,
  images: ExtractedImage[],
  metadata?: ArticleMetadata | null,
): string {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sourceImages = uniqueUrls([
    ...(metadata?.source_images ?? []),
    ...images.map((image) => image.url),
  ], url);

  return JSON.stringify({
    source,
    url,
    word_count: wordCount,
    text: text.slice(0, 50000),
    ...(metadata?.title ? { title: metadata.title } : {}),
    ...(metadata?.published_at ? { published_at: metadata.published_at } : {}),
    ...(metadata?.author ? { author: metadata.author } : {}),
    ...(metadata?.author_handle ? { author_handle: metadata.author_handle } : {}),
    ...(metadata?.author_platform ? { author_platform: metadata.author_platform } : {}),
    ...(metadata?.author_url ? { author_url: metadata.author_url } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(sourceImages.length > 0 ? { source_images: sourceImages } : {}),
  });
}

// ---------------------------------------------------------------------------
// Generic text extraction (articles, blogs)
// ---------------------------------------------------------------------------

async function extractText(url: string): Promise<string> {
  streamStatus("Extracting article...");
  const metadataPromise = fetchArticleMetadata(url);

  // Try markdown.new first (clean article extraction, handles JS-rendered pages)
  try {
    const mdRes = await fetch(`https://markdown.new/${url}`, {
      headers: { Accept: "text/markdown" },
    });
    if (mdRes.ok) {
      const md = (await mdRes.text()).trim();
      if (md.length > 100) {
        const images = extractImagesFromMarkdown(md);
        const metadata = await metadataPromise;
        const payload = buildArticlePayload("markdown.new", url, md, images, metadata);
        const parsed = JSON.parse(payload) as { word_count?: number };
        console.error(`  markdown.new: ${parsed.word_count ?? 0} words, ${images.length} images extracted`);
        return payload;
      }
    }
  } catch {
    console.error("  markdown.new unavailable, falling back to raw fetch");
  }

  // Fallback: raw fetch + regex strip
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    return JSON.stringify({ source: "text", url, error: `HTTP ${res.status}` });
  }

  const html = await res.text();

  // Extract images before stripping HTML
  const images = extractImagesFromHtml(html, url);
  const htmlMetadata = extractArticleMetadataFromHtml(html, url, undefined, images);

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

  const payload = buildArticlePayload("text", url, text, images, htmlMetadata);
  const parsed = JSON.parse(payload) as { word_count?: number };
  console.error(`  raw fetch: ${parsed.word_count ?? 0} words, ${images.length} images extracted`);
  return payload;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error(
      "Usage: bun run skill/scripts/extract.ts <url>"
    );
    process.exit(1);
  }

  const type = classifyUrl(url);
  const { streamLog } = await import("./stream-log");
  streamLog(`Extracting ${type} content from: ${url}`);

  try {
    let result: string;
    if (type === "youtube") {
      result = await extractYoutube(url);
    } else if (type === "tweet") {
      result = await extractTweet(url);
    } else {
      result = await extractText(url);
    }
    // Save successful extractions for persistence across conversation turns
    const parsed = JSON.parse(result);
    if (!parsed.error) {
      const hash = new Bun.CryptoHasher("sha256").update(url).digest("hex").slice(0, 12);
      const dir = getRuntimeSourceDir();
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `source-${hash}.json`);
      parsed.saved_to = filePath;

      // Download attached images to local files so the skill agent can read
      // them with vision (charts, screenshots, diagrams are critical context).
      if (Array.isArray(parsed.images) && parsed.images.length > 0) {
        const imageFiles: string[] = [];
        for (let i = 0; i < Math.min(parsed.images.length, 4); i++) {
          const img = parsed.images[i];
          const imgUrl = typeof img === "string" ? img : img?.url;
          if (!imgUrl) continue;
          try {
            const imgRes = await fetch(imgUrl);
            if (imgRes.ok) {
              const ext = imgUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] ?? "jpg";
              const imgPath = join(dir, `source-${hash}-img${i}.${ext}`);
              await Bun.write(imgPath, await imgRes.arrayBuffer());
              imageFiles.push(imgPath);
              console.error(`[transcript] Downloaded image ${i + 1}: ${imgPath}`);
            }
          } catch (e: any) {
            console.error(`[transcript] Failed to download image ${i + 1}: ${e.message}`);
          }
        }
        if (imageFiles.length > 0) {
          parsed.image_files = imageFiles;
        }
      }

      await Bun.write(filePath, JSON.stringify(parsed));
      streamLog(`Saved to ${filePath}`);
    }

    // YouTube: omit transcript from stdout so the model sees metadata only.
    // The full transcript is in the saved_to file — read it after resolving
    // whether diarization is needed. Other source types return text inline.
    if (type === "youtube" && parsed.transcript && !parsed.error) {
      const { transcript, ...metadata } = parsed;
      metadata.transcript_saved = true;
      console.log(JSON.stringify(metadata));
    } else {
      console.log(JSON.stringify(parsed));
    }
  } catch (err: any) {
    console.error(`[transcript] Error: ${err.message}`);
    console.log(
      JSON.stringify({
        source: type,
        url,
        error: err.message,
        fallback: "Paste content directly or share a screenshot",
      })
    );
  }
}

main();
