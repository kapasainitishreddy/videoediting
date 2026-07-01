import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { mkdtemp, readFile, rm, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export const maxDuration = 120;

const ALLOWED_HOSTS = [
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "facebook.com",
  "www.facebook.com",
];

// POST { url } → downloads the reel with yt-dlp and streams the mp4 back.
// The file is deleted from the server immediately after the response is
// built — the only durable copy lives in the browser's IndexedDB.
export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return Response.json({ error: "That doesn't look like a valid link" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return Response.json(
      { error: "Unsupported site. Paste an Instagram, TikTok, YouTube, X, or Facebook link." },
      { status: 400 }
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), "viraledit-"));
  try {
    const outTemplate = path.join(dir, "reel.%(ext)s");
    const result = await runYtDlp([
      "--no-playlist",
      "--max-filesize", "200M",
      "-f", "mp4/bv*[ext=mp4]+ba[ext=m4a]/b",
      "--merge-output-format", "mp4",
      "-o", outTemplate,
      "--print-json",
      "--no-warnings",
      url,
    ]);

    if (result.code !== 0) {
      const hint = result.stderr.includes("login")
        ? "This post may be private or age-restricted."
        : "The site may be blocking downloads right now.";
      return Response.json(
        { error: `Download failed. ${hint}`, detail: result.stderr.slice(-400) },
        { status: 502 }
      );
    }

    let title = "reel";
    try {
      const meta = JSON.parse(result.stdout.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}");
      title = (meta.title || meta.id || "reel").slice(0, 80);
    } catch {
      // metadata is best-effort
    }

    const files = await readdir(dir);
    const videoFile = files.find((f) => f.endsWith(".mp4")) ?? files[0];
    if (!videoFile) {
      return Response.json({ error: "Downloaded but no video file found" }, { status: 502 });
    }
    const data = await readFile(path.join(dir, videoFile));

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "video/mp4",
        "X-Video-Title": encodeURIComponent(title),
        "Cache-Control": "no-store",
      },
    });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runYtDlp(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", args, { timeout: 110_000 });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", (err) => resolve({ code: 1, stdout, stderr: String(err) }));
  });
}
