"use client";

// AI background removal — MediaPipe selfie segmentation (250KB model,
// committed in /models, WASM served same-origin from /vision). The clip is
// played once through a canvas: each frame is masked to the person and
// composited over the chosen background, and the canvas stream is recorded
// into a NEW derived clip. Original audio is carried across. Everything
// stays on-device.
//
// This is preprocessing, not a render-time filter: per-frame ML inside the
// FFmpeg pipeline would be brutally slow in WASM, while play-through
// processing costs roughly the clip's own duration.

export interface RemoveBgOptions {
  bg: "blur" | "studio" | string; // blur = bokeh, studio = app dark, or #hex
  onProgress?: (frac: number) => void;
}

type MpImageSegmenter = import("@mediapipe/tasks-vision").ImageSegmenter;

let segmenterPromise: Promise<MpImageSegmenter | null> | null = null;

export function getSegmenter(): Promise<MpImageSegmenter | null> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks("/vision");
        return await vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/selfie_segmenter.tflite" },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
        });
      } catch {
        return null;
      }
    })();
  }
  return segmenterPromise;
}

const STUDIO_BG = "#101014";

export async function removeBackground(
  blob: Blob,
  opts: RemoveBgOptions
): Promise<{ blob: Blob; note: string }> {
  const seg = await getSegmenter();
  if (!seg) {
    throw new Error(
      "The background model couldn't load on this device — for green-screen footage, use Green screen key instead."
    );
  }

  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = false;
  v.volume = 0; // keep the audio track alive for captureStream, silently
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("remove-bg: clip failed to load"));
  });
  let duration = v.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = 1e7;
    });
    duration = Number.isFinite(v.duration) ? v.duration : v.currentTime;
    v.currentTime = 0;
  }

  const W = Math.min(720, v.videoWidth || 720);
  const H = Math.round((W / Math.max(1, v.videoWidth || W)) * (v.videoHeight || 1280));
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d")!;

  // person cut-out working canvas (video frame masked by confidence)
  const cut = document.createElement("canvas");
  cut.width = W;
  cut.height = H;
  const cutCtx = cut.getContext("2d", { willReadFrequently: true })!;
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d")!;

  // recorder: canvas video + the clip's own audio
  const stream = out.captureStream(30);
  try {
    const media = (v as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    media?.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  } catch {
    /* silent clip is fine */
  }
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));

  const drawBg = () => {
    if (opts.bg === "blur") {
      ctx.save();
      ctx.filter = "blur(14px) brightness(0.82)";
      // overdraw past the edges so the blur doesn't vignette
      ctx.drawImage(v, -20, -20, W + 40, H + 40);
      ctx.restore();
    } else {
      ctx.fillStyle = opts.bg === "studio" ? STUDIO_BG : opts.bg;
      ctx.fillRect(0, 0, W, H);
    }
  };

  let lastTs = -1;
  const processFrame = () => {
    const nowMs = performance.now();
    const tsMs = Math.max(lastTs + 1, Math.round(v.currentTime * 1000));
    lastTs = tsMs;
    const res = seg.segmentForVideo(v, nowMs);
    const mask = res.confidenceMasks?.[0];
    drawBg();
    if (mask) {
      const mw = mask.width;
      const mh = mask.height;
      const conf = mask.getAsFloat32Array();
      const img = new ImageData(mw, mh);
      for (let i = 0; i < mw * mh; i++) {
        // alpha-only mask; slight gamma to firm up the edge
        img.data[i * 4 + 3] = Math.round(Math.min(1, conf[i] * 1.15) ** 1.5 * 255);
      }
      maskCanvas.width = mw;
      maskCanvas.height = mh;
      maskCtx.putImageData(img, 0, 0);
      // person = frame ∩ mask
      cutCtx.clearRect(0, 0, W, H);
      cutCtx.drawImage(v, 0, 0, W, H);
      cutCtx.globalCompositeOperation = "destination-in";
      cutCtx.drawImage(maskCanvas, 0, 0, W, H);
      cutCtx.globalCompositeOperation = "source-over";
      ctx.drawImage(cut, 0, 0);
    } else {
      ctx.drawImage(v, 0, 0, W, H);
    }
    res.close();
    opts.onProgress?.(Math.min(1, v.currentTime / Math.max(0.1, duration)));
  };

  type VFC = HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  const vfc = v as VFC;

  await new Promise<void>((resolve, reject) => {
    let raf = 0;
    const tick = () => {
      if (v.ended || v.currentTime >= duration - 0.03) {
        resolve();
        return;
      }
      try {
        processFrame();
      } catch (e) {
        reject(e instanceof Error ? e : new Error("segmentation failed"));
        return;
      }
      if (vfc.requestVideoFrameCallback) vfc.requestVideoFrameCallback(tick);
      else raf = requestAnimationFrame(tick);
    };
    v.onended = () => resolve();
    v.onerror = () => reject(new Error("remove-bg: playback failed"));
    v.play()
      .then(() => {
        rec.start(200);
        if (vfc.requestVideoFrameCallback) vfc.requestVideoFrameCallback(tick);
        else raf = requestAnimationFrame(tick);
      })
      .catch(() => reject(new Error("remove-bg: playback was blocked")));
    // safety net: never hang past clip length + 5s
    setTimeout(() => {
      cancelAnimationFrame(raf);
      resolve();
    }, (duration + 5) * 1000);
  });

  rec.stop();
  await stopped;
  v.pause();
  URL.revokeObjectURL(url);

  const outBlob = new Blob(chunks, { type: "video/webm" });
  if (outBlob.size < 1000) throw new Error("remove-bg: recording came out empty");
  const bgName = opts.bg === "blur" ? "blurred" : opts.bg === "studio" ? "studio black" : opts.bg;
  return { blob: outBlob, note: `Background removed (${bgName})` };
}
