"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SLIDES = [
  {
    art: "REEL PREVIEW",
    title: (
      <>
        Reverse-engineer
        <br />
        any viral edit
      </>
    ),
    body: "Paste any reel and get the exact cut map, transitions, and beat sync — frame by frame.",
  },
  {
    art: "CUT MAP",
    title: (
      <>
        AI extracts every
        <br />
        transition for you
      </>
    ),
    body: "Whip pans, zoom punches, flash cuts — detected automatically and saved to your library with recreation tips.",
  },
  {
    art: "YOUR EDIT",
    title: (
      <>
        Your clips, edited
        <br />
        by direction
      </>
    ),
    body: "Upload your footage, type what you want — “make it cinematic” — and export a beat-synced edit in one tap.",
  },
  {
    art: "ON YOUR DEVICE",
    title: (
      <>
        Free to edit,
        <br />
        private by design
      </>
    ),
    body: "Every cut and export runs on your own device — no watermark, no upload. Add any AI key, even a basic one, and it just gets smarter.",
  },
];

export default function Onboarding() {
  const [i, setI] = useState(0);
  const router = useRouter();
  const last = i === SLIDES.length - 1;
  const go = () => (last ? router.push("/home") : setI(i + 1));

  return (
    <main className="flex flex-1 flex-col px-8 pb-10 pt-4">
      <div className="flex justify-end pt-6">
        <button
          onClick={() => router.push("/home")}
          className="text-muted text-lg font-medium px-2 py-1"
        >
          Skip
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        <div
          key={i}
          className="stripes slide-up flex h-[46vh] w-[76%] items-center justify-center rounded-3xl"
        >
          <span className="font-mono text-sm tracking-[0.35em] text-neutral-500">
            {SLIDES[i].art}
          </span>
        </div>

        <div key={`t${i}`} className="slide-up text-center">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
            {SLIDES[i].title}
          </h1>
          <p className="mx-auto mt-5 max-w-xs text-lg leading-7 text-neutral-400">
            {SLIDES[i].body}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {SLIDES.map((_, d) => (
            <span
              key={d}
              className={
                d === i
                  ? "h-2 w-7 rounded-full bg-accent transition-all"
                  : "h-2 w-2 rounded-full bg-neutral-700 transition-all"
              }
            />
          ))}
        </div>
        <button onClick={go} className="btn-primary px-9 py-4 text-lg">
          {last ? "Start →" : "Next →"}
        </button>
      </div>
    </main>
  );
}
