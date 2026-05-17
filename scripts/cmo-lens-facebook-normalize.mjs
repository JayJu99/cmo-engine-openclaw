import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const outputPath = path.join(workspaceRoot, "data", "cmo-dashboard", "channel-metrics", "holdstation-mini-app", "facebook.json");
const defaultTimezone = process.env.CMO_VAULT_TIME_ZONE || "Asia/Saigon";
const dryRun = process.argv.includes("--dry-run");
const printSnapshot = process.argv.includes("--print-snapshot");
const candidateDirs = [
  "knowledge/holdstation/07 Knowledge/Data/facebook-page/processed",
  "knowledge/holdstation/07 Knowledge/Data/facebook-page/raw",
  "knowledge/holdstation/07 Knowledge/Data/facebook-page/reports",
  "knowledge/holdstation/05 Agents/Lens/Reports/Facebook/Daily",
  "knowledge/holdstation/05 Agents/Lens/Reports/Facebook/Weekly",
  "knowledge/holdstation/05 Agents/Lens/Reports/Facebook/Monthly",
];
const metricDefinitions = [
  {
    id: "facebook_views",
    label: "Facebook Views",
    unit: "count",
    description: "Facebook content/page views reported by Lens when available.",
    caveat: "Reach/impressions may use Meta media view proxies.",
    keys: ["page_media_view", "page_views_total", "post_media_view", "media_view", "views"],
  },
  {
    id: "facebook_unique_views",
    label: "Unique Views Proxy",
    unit: "count",
    description: "Unique media/page view proxy reported by Lens when available.",
    caveat: "This is a unique views proxy, not confirmed classic reach.",
    keys: ["page_total_media_view_unique", "post_total_media_view_unique", "media_view_unique", "unique_views"],
  },
  {
    id: "facebook_engagement",
    label: "Engagement",
    unit: "count",
    description: "Visible engagement or page post engagement reported by Lens.",
    keys: ["page_post_engagements", "visible_engagement", "visibleEngagement", "engagement", "engagements"],
  },
  {
    id: "facebook_post_count",
    label: "Post Count",
    unit: "count",
    description: "Processed Facebook posts in the selected range.",
    keys: [],
  },
  {
    id: "facebook_video_views",
    label: "Video Views",
    unit: "count",
    description: "Facebook video views reported by Lens when available.",
    keys: ["page_video_views", "post_video_views", "video_views", "videoViews"],
  },
  {
    id: "facebook_follower_count",
    label: "Followers",
    unit: "count",
    description: "Facebook Page follower count when available.",
    keys: ["followers_count", "follower_count", "followersCount"],
    mode: "max",
  },
  {
    id: "facebook_follower_growth",
    label: "Follower Growth",
    unit: "count",
    description: "Follower growth from Lens if supplied or safely calculated upstream.",
    keys: ["page_follows", "follower_growth", "followers_delta", "follows"],
  },
  {
    id: "facebook_link_clicks",
    label: "Link Clicks",
    unit: "count",
    description: "Facebook link clicks from Lens if confirmed.",
    keys: ["link_clicks", "linkClicks"],
  },
  {
    id: "facebook_ctr",
    label: "CTR",
    unit: "percent",
    description: "Facebook click-through rate from Lens if confirmed.",
    keys: ["ctr", "click_through_rate"],
    mode: "max",
  },
];

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function zonedDateParts(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value || "0");

  return { year: part("year"), month: part("month"), day: part("day") };
}

function thisWeekRange(now = new Date(), timezone = defaultTimezone) {
  const parts = zonedDateParts(now, timezone);
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() + mondayOffset);

  return {
    preset: "this_week",
    startDate: isoDate(start),
    endDate: isoDate(today),
    timezone,
  };
}

async function listFiles(dir) {
  const absoluteDir = path.join(workspaceRoot, dir);

  if (!existsSync(absoluteDir)) {
    return { files: [], missing: dir };
  }

  const results = [];
  const stack = [absoluteDir];

  while (stack.length) {
    const current = stack.pop();
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(current, { withFileTypes: true }));

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile() && /\.(json|csv|md)$/i.test(entry.name)) {
        results.push(absolute);
      }
    }
  }

  return { files: results, missing: null };
}

function csvCells(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());

  return cells;
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    return [];
  }

  const headers = csvCells(lines[0]).map((header) => header.replace(/^"|"$/g, "").trim());

  return lines.slice(1).map((line) => {
    const cells = csvCells(line);

    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function parseMarkdownMetrics(content) {
  const record = {};

  content.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:[-*]\s*)?([A-Za-z0-9_ -]{3,80})\s*:\s*(-?\d+(?:\.\d+)?)\s*$/);

    if (match) {
      record[match[1].trim()] = Number(match[2]);
    }
  });

  return Object.keys(record).length ? record : null;
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function keyName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function metricKeySet(keys) {
  return new Set(keys.map(keyName));
}

function collectNumbers(node, keys, values = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectNumbers(item, keys, values));
    return values;
  }

  if (!node || typeof node !== "object") {
    return values;
  }

  for (const [key, value] of Object.entries(node)) {
    if (keys.has(keyName(key))) {
      const next = numeric(value);

      if (next !== null) {
        values.push(next);
      }
    }

    if (value && typeof value === "object") {
      collectNumbers(value, keys, values);
    }
  }

  return values;
}

function firstString(record, keys) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function postCandidate(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const explicitPostId = firstString(record, ["post_id", "postId"]);
  const genericId = firstString(record, ["id"]);
  const permalink = firstString(record, ["permalink_url", "permalinkUrl", "url"]);
  const message = firstString(record, ["message", "caption", "text", "messagePreview"]);
  const createdTime = firstString(record, ["created_time", "createdTime", "timestamp", "date"]);
  const views = numeric(record.views) ?? numeric(record.post_media_view) ?? numeric(record.media_view) ?? numeric(record.page_media_view);
  const visibleEngagement = numeric(record.visible_engagement) ?? numeric(record.visibleEngagement) ?? numeric(record.engagement) ?? numeric(record.page_post_engagements);
  const engagementRate = numeric(record.engagement_rate) ?? numeric(record.engagementRate);
  const id = explicitPostId || (permalink || message || createdTime ? genericId : undefined);

  if (!id && !permalink && !message && !createdTime) {
    return null;
  }

  return {
    id: id || permalink || `post-${Math.abs(JSON.stringify(record).length)}`,
    postId: id,
    createdTime,
    permalinkUrl: permalink,
    messagePreview: message ? message.replace(/\s+/g, " ").slice(0, 140) : undefined,
    inferredContentType: firstString(record, ["type", "content_type", "contentType"]) || undefined,
    views,
    visibleEngagement,
    engagementRate,
    bucket: firstString(record, ["bucket"]) || "unknown",
  };
}

function collectPosts(node, posts = new Map()) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectPosts(item, posts));
    return posts;
  }

  if (!node || typeof node !== "object") {
    return posts;
  }

  const candidate = postCandidate(node);

  if (candidate) {
    posts.set(candidate.id, candidate);
  }

  Object.values(node).forEach((value) => {
    if (value && typeof value === "object") {
      collectPosts(value, posts);
    }
  });

  return posts;
}

function displayValue(metric, value) {
  if (value === null) {
    return "No data";
  }

  if (metric.unit === "percent") {
    return `${Number(value.toFixed(2))}%`;
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function normalizeMetric(metric, value) {
  return {
    id: metric.id,
    label: metric.label,
    value,
    displayValue: displayValue(metric, value),
    unit: metric.unit,
    status: value === null ? "missing" : "connected",
    description: metric.description,
    ...(metric.caveat ? { caveat: metric.caveat } : {}),
  };
}

function summarizeValues(values, mode) {
  if (!values.length) {
    return null;
  }

  if (mode === "max") {
    return Math.max(...values);
  }

  return values.reduce((total, value) => total + value, 0);
}

async function readStructuredFiles(files) {
  const parsed = [];
  const seenFiles = [];
  let latestMtime = null;

  for (const file of files.slice(0, 250)) {
    const info = await stat(file);

    if (info.size > 5_000_000) {
      continue;
    }

    try {
      const content = await readFile(file, "utf8");
      const lowerFile = file.toLowerCase();

      if (lowerFile.endsWith(".json")) {
        parsed.push(JSON.parse(content));
      } else if (lowerFile.endsWith(".csv")) {
        parsed.push(parseCsv(content));
      } else if (lowerFile.endsWith(".md")) {
        const markdownMetrics = parseMarkdownMetrics(content);

        if (markdownMetrics) {
          parsed.push(markdownMetrics);
        }
      }

      seenFiles.push(path.relative(workspaceRoot, file).replace(/\\/g, "/"));
      latestMtime = latestMtime && latestMtime > info.mtime ? latestMtime : info.mtime;
    } catch {
      seenFiles.push(`${path.relative(workspaceRoot, file).replace(/\\/g, "/")} (unparsed)`);
    }
  }

  return { parsed, seenFiles, latestMtime };
}

async function buildSnapshot() {
  const listings = await Promise.all(candidateDirs.map(listFiles));
  const files = listings.flatMap((listing) => listing.files);
  const missingDirs = listings.map((listing) => listing.missing).filter(Boolean);
  const { parsed, seenFiles, latestMtime } = await readStructuredFiles(files);
  const posts = new Map();

  parsed.forEach((node) => collectPosts(node, posts));

  const metrics = metricDefinitions.map((metric) => {
    if (metric.id === "facebook_post_count") {
      return normalizeMetric(metric, posts.size || null);
    }

    const values = parsed.flatMap((node) => collectNumbers(node, metricKeySet(metric.keys)));
    return normalizeMetric(metric, summarizeValues(values, metric.mode));
  });
  const availableMetrics = metrics.filter((metric) => metric.status === "connected" && metric.value !== null).map((metric) => metric.id);
  const missingMetrics = metrics.filter((metric) => metric.status !== "connected" || metric.value === null).map((metric) => metric.id);
  const topPosts = [...posts.values()]
    .sort((left, right) => (right.views || 0) + (right.visibleEngagement || 0) - ((left.views || 0) + (left.visibleEngagement || 0)))
    .slice(0, 3);
  const source = availableMetrics.length ? "lens.facebook_page" : files.length ? "lens.facebook_page" : "not_connected";
  const status = availableMetrics.length === metrics.length ? "connected" : availableMetrics.length ? "partial" : "missing";
  const notes = [
    availableMetrics.length ? "Normalized from Lens Facebook output files." : "No usable Lens Facebook numeric metrics found.",
    files.length ? `Candidate files found: ${files.length}.` : "No Lens Facebook files found in expected output locations.",
    seenFiles.length ? `Structured files inspected: ${seenFiles.slice(0, 8).join(", ")}${seenFiles.length > 8 ? ", ..." : ""}.` : "",
    missingDirs.length ? `Missing input directories: ${missingDirs.join(", ")}.` : "",
    "Facebook channel metrics are separate from cmo.app-metrics.v1 product metrics.",
    "Reach/impressions may use Meta media view proxies when available.",
  ].filter(Boolean);

  return {
    schemaVersion: "cmo.channel-metrics.v1",
    workspaceId: "holdstation",
    appId: "holdstation-mini-app",
    sourceId: "holdstation__holdstation-mini-app",
    channel: "facebook",
    source,
    dateRange: thisWeekRange(),
    status,
    lastUpdatedAt: latestMtime ? latestMtime.toISOString() : null,
    metrics,
    ...(topPosts.length ? { topPosts } : {}),
    diagnostics: {
      availableMetrics,
      missingMetrics,
      notes,
    },
  };
}

async function writeSnapshot(snapshot) {
  if (dryRun) {
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(tempPath, outputPath);
}

const snapshot = await buildSnapshot();
await writeSnapshot(snapshot);

console.log(
  JSON.stringify(
    printSnapshot
      ? snapshot
      : { ok: true, dryRun, outputPath: path.relative(workspaceRoot, outputPath), status: snapshot.status, availableMetrics: snapshot.diagnostics.availableMetrics },
    null,
    2,
  ),
);
