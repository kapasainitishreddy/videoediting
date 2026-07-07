// Creator marketing / GTM toolkit — pure, Node-testable.
// Playbook structure adapted for creators from the open-source
// ai-marketing-skills collection (github.com/ericosiu/ai-marketing-skills):
// content ops → calendar + slop check, growth engine → A/B experiment plans,
// conversion ops → UTM links + title optimizer, outbound → sponsor pitches,
// deck generator → media kit, podcast ops → repurposing matrix. All
// implementations are original TypeScript, run fully on-device, and are
// honest heuristics — playbooks, not oracles.

// Deterministic PRNG (same pattern as creator-growth) so tests are stable
// and "reroll" is just a seed bump.
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// 1. Slop check / humanizer — does this caption read like AI filler?
//    (adapted from the "X Long-Form + Humanizer" skill's slop-detection idea)
// ---------------------------------------------------------------------------

export interface SlopFlag {
  phrase: string;
  why: string;
}

export interface SlopReport {
  score: number; // 0..100 — higher = more human
  flags: SlopFlag[];
  verdict: string;
}

const SLOP_PHRASES: [RegExp, string][] = [
  [/\bgame.?changer\b/i, "the most burned-out phrase on the internet"],
  [/\bdelve\b/i, "classic AI tell — nobody says 'delve' out loud"],
  [/\bunlock (?:the|your)\b/i, "AI-brochure verb — say what it actually does"],
  [/\bin today'?s (?:fast-paced|digital) world\b/i, "empty scene-setting filler"],
  [/\belevate your\b/i, "AI-brochure verb — be concrete instead"],
  [/\brevolutioniz/i, "overclaim — show the result instead"],
  [/\bseamless(?:ly)?\b/i, "SaaS-brochure adjective"],
  [/\bunleash\b/i, "AI-hype verb"],
  [/\bdive (?:in|into|deep)\b/i, "the second most common AI opener"],
  [/\blook no further\b/i, "infomercial filler"],
  [/\btake (?:it|your \w+) to the next level\b/i, "says nothing measurable"],
  [/\bat the end of the day\b/i, "filler idiom"],
  [/\bwhether you'?re a\b/i, "the AI audience-enumeration pattern"],
  [/\bit'?s not just a?\b.{0,30}\bit'?s\b/i, "'it's not just X, it's Y' — the most recognizable AI sentence shape"],
];

export function slopCheck(text: string): SlopReport {
  const flags: SlopFlag[] = [];
  for (const [re, why] of SLOP_PHRASES) {
    const m = text.match(re);
    if (m) flags.push({ phrase: m[0], why });
  }
  const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const per100 = (emojiCount / Math.max(1, text.length)) * 100;
  if (per100 > 4) flags.push({ phrase: `${emojiCount} emoji`, why: "emoji density reads as engagement-bait" });
  const hashtags = (text.match(/#[\w]+/g) ?? []).length;
  if (hashtags > 8) flags.push({ phrase: `${hashtags} hashtags`, why: "hashtag stuffing — platforms downrank past ~5" });
  const shouting = (text.match(/\b[A-Z]{4,}\b/g) ?? []).length;
  if (shouting > 2) flags.push({ phrase: "ALL-CAPS words", why: "shouting reads as spam" });
  const emDashes = (text.match(/—/g) ?? []).length;
  if (emDashes >= 3 && text.length < 600) flags.push({ phrase: `${emDashes} em-dashes`, why: "em-dash chains are an AI-writing tell" });

  const score = Math.max(0, Math.min(100, 100 - flags.length * 14));
  const verdict =
    score >= 86
      ? "Reads human — post it."
      : score >= 58
        ? "A few AI-isms — swap the flagged phrases for something you'd actually say."
        : "This reads machine-written. Rewrite it the way you'd tell a friend.";
  return { score, flags, verdict };
}

// ---------------------------------------------------------------------------
// 2. Title / hook-line optimizer (conversion-ops style checklist scoring)
// ---------------------------------------------------------------------------

export interface TitleReport {
  score: number; // 0..100
  tips: string[];
  rewrites: string[];
}

const CURIOSITY = /\b(why|how|secret|mistake|nobody|stop|never|before|wrong|truth|actually)\b/i;

export function optimizeTitle(title: string, seed = 1): TitleReport {
  const t = title.trim();
  const tips: string[] = [];
  let score = 35;

  if (t.length >= 20 && t.length <= 60) score += 20;
  else tips.push(t.length < 20 ? "Too short to carry a promise — aim for 20–60 characters." : "Over ~60 characters gets truncated in feeds.");
  if (/\d/.test(t)) score += 15;
  else tips.push("Titles with a concrete number out-click vague ones (\"3 mistakes\", \"30 days\").");
  if (CURIOSITY.test(t)) score += 15;
  else tips.push("No curiosity trigger — words like \"why / mistake / nobody\" open a loop viewers stay to close.");
  if (!/[A-Z]{4,}/.test(t)) score += 10;
  else tips.push("ALL-CAPS words read as clickbait to both viewers and ranking systems.");
  if (!/[!?]{2,}/.test(t)) score += 5;
  else tips.push("Stacked punctuation (!!, ??) reads as spam.");

  const core = t.replace(/[.!?]+$/, "") || "this";
  const rnd = lcg(seed * 31 + t.length);
  const forms = [
    `Why ${core.charAt(0).toLowerCase()}${core.slice(1)} (nobody tells you this)`,
    `I tried ${core.toLowerCase()} for 30 days`,
    `The ${core.toLowerCase()} mistake everyone makes`,
    `${core} — before you start, watch this`,
    `3 things about ${core.toLowerCase()} I wish I knew sooner`,
  ];
  const rewrites: string[] = [];
  while (rewrites.length < 3) {
    const pick = forms[Math.floor(rnd() * forms.length) % forms.length];
    if (!rewrites.includes(pick)) rewrites.push(pick);
  }
  return { score: Math.min(100, score), tips, rewrites };
}

// ---------------------------------------------------------------------------
// 3. Content calendar (content-ops cadence planning)
// ---------------------------------------------------------------------------

export interface CalendarSlot {
  day: string;
  format: string;
  angle: string;
  cta: string;
  bestTime: string;
}

const FORMATS: { format: string; angle: (topic: string) => string; cta: string }[] = [
  { format: "Hook-led tip", angle: (t) => `One specific ${t} tip, payoff in the first 3 seconds`, cta: "Follow for one of these every week" },
  { format: "Behind the scenes", angle: (t) => `How a ${t} post actually gets made — the unglamorous part`, cta: "Comment what you want a BTS of next" },
  { format: "Trend remix", angle: (t) => `Current trending sound/format, rewritten for ${t}`, cta: "Save this before the trend dies" },
  { format: "Story / case", angle: (t) => `A before → after ${t} story with real numbers`, cta: "The full breakdown is in the pinned comment" },
  { format: "Hot take", angle: (t) => `The ${t} advice you disagree with, and what to do instead`, cta: "Tell me why I'm wrong" },
  { format: "Repurposed highlight", angle: (t) => `Best 20s of your last long ${t} video, recut vertical`, cta: "Full video on the channel" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMES = ["7–9am (commute scroll)", "12–1pm (lunch scroll)", "7–10pm (prime time)"];

export function contentCalendar(topic: string, opts: { weeks?: number; perWeek?: number; seed?: number } = {}): CalendarSlot[][] {
  const weeks = Math.max(1, Math.min(4, opts.weeks ?? 2));
  const perWeek = Math.max(2, Math.min(7, opts.perWeek ?? 4));
  const rnd = lcg((opts.seed ?? 1) * 101 + topic.length);
  const out: CalendarSlot[][] = [];
  let fi = Math.floor(rnd() * FORMATS.length);
  for (let w = 0; w < weeks; w++) {
    const week: CalendarSlot[] = [];
    const dayStep = Math.floor(7 / perWeek);
    for (let p = 0; p < perWeek; p++) {
      const f = FORMATS[fi % FORMATS.length];
      fi++;
      week.push({
        day: DAYS[Math.min(6, p * dayStep + (w % 2))],
        format: f.format,
        angle: f.angle(topic),
        cta: f.cta,
        bestTime: TIMES[Math.floor(rnd() * TIMES.length) % TIMES.length],
      });
    }
    out.push(week);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. UTM link builder (attribution the simple, correct way)
// ---------------------------------------------------------------------------

export function utmLink(
  base: string,
  p: { source: string; medium?: string; campaign?: string; content?: string }
): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`);
  } catch {
    return { ok: false, error: "That doesn't look like a valid link." };
  }
  const slug = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\w-]/g, "").slice(0, 60);
  if (!p.source.trim()) return { ok: false, error: "utm_source is required (where the click comes from: tiktok, reels, yt…)." };
  u.searchParams.set("utm_source", slug(p.source));
  u.searchParams.set("utm_medium", slug(p.medium || "social"));
  if (p.campaign?.trim()) u.searchParams.set("utm_campaign", slug(p.campaign));
  if (p.content?.trim()) u.searchParams.set("utm_content", slug(p.content));
  return { ok: true, url: u.toString() };
}

// ---------------------------------------------------------------------------
// 5. A/B experiment plan (growth-engine style, sized honestly)
// ---------------------------------------------------------------------------

export interface ExperimentPlan {
  hypothesis: string;
  variants: string[];
  metric: string;
  guardrail: string;
  split: string;
  minPerVariant: number;
  durationDays: number;
  decisionRule: string;
}

export function abExperimentPlan(input: {
  what: "hook" | "thumbnail" | "title" | "cta";
  variants: string[];
  dailyViews?: number;
}): ExperimentPlan | null {
  const variants = input.variants.filter((v) => v.trim()).slice(0, 4);
  if (variants.length < 2) return null;
  const METRICS: Record<string, { metric: string; guardrail: string }> = {
    hook: { metric: "3-second hold rate (viewers still watching at 3s)", guardrail: "average watch time must not drop >10%" },
    thumbnail: { metric: "click-through rate", guardrail: "average view duration must not drop (clickbait check)" },
    title: { metric: "click-through rate", guardrail: "3-second hold rate must not drop" },
    cta: { metric: "profile taps / link clicks per 1k views", guardrail: "completion rate must not drop" },
  };
  const m = METRICS[input.what];
  // rough two-proportion sizing: detecting a ~20% relative lift on a ~5%
  // base rate needs ~2.5–3k per arm; scale bluntly and honestly.
  const minPerVariant = 2500;
  const daily = Math.max(50, input.dailyViews ?? 500);
  const durationDays = Math.min(30, Math.max(3, Math.ceil((minPerVariant * variants.length) / daily)));
  return {
    hypothesis: `Changing the ${input.what} changes ${m.metric.split(" (")[0]} by a meaningful margin.`,
    variants,
    metric: m.metric,
    guardrail: m.guardrail,
    split: variants.length === 2 ? "post A and B 24h apart at the same time-of-day, or use the platform's native A/B tool" : "rotate one variant per post at the same slot",
    minPerVariant,
    durationDays,
    decisionRule: `Call a winner only if it leads by ≥20% relative with ~${minPerVariant.toLocaleString()} views per variant — below that, the difference is probably noise. If the guardrail drops, the "winner" is bait; kill it.`,
  };
}

// ---------------------------------------------------------------------------
// 6. Sponsor pitch (outbound-engine adapted to brand deals)
// ---------------------------------------------------------------------------

export interface SponsorPitch {
  subjects: string[];
  email: string;
  followUps: { day: number; message: string }[];
}

export function sponsorPitch(p: {
  creator: string;
  niche: string;
  followers?: string;
  avgViews?: string;
  brand: string;
  angle?: string;
}): SponsorPitch {
  const brand = p.brand.trim() || "your brand";
  const niche = p.niche.trim() || "my niche";
  const stats = [p.followers && `${p.followers} followers`, p.avgViews && `${p.avgViews} avg views`].filter(Boolean).join(", ");
  const angle = p.angle?.trim() || `an integration that shows ${brand} inside real ${niche} content instead of an ad read`;
  return {
    subjects: [
      `${niche} audience × ${brand} — one concrete idea`,
      `Quick idea for ${brand} (${stats || "creator partnership"})`,
      `${brand} in front of ${p.followers || "my"} ${niche} viewers`,
    ],
    email: [
      `Hi ${brand} team,`,
      ``,
      `I'm ${p.creator || "a creator"} — I make ${niche} content${stats ? ` (${stats})` : ""}.`,
      ``,
      `One concrete idea: ${angle}. My audience matches the people who already buy from you, and I'd rather pitch one specific concept than send a media kit cold — happy to share the kit and exact numbers if this is interesting.`,
      ``,
      `Worth a 15-minute call this week?`,
      ``,
      `${p.creator || "—"}`,
    ].join("\n"),
    followUps: [
      { day: 3, message: "Bumping this — the idea has a shelf life (trend-tied). Still happy to send the media kit + numbers." },
      { day: 7, message: `Last nudge: if ${brand} partnerships go through someone else, could you point me to them? Then I'll stop landing in your inbox.` },
    ],
  };
}

// ---------------------------------------------------------------------------
// 7. Media kit (deck-generator adapted: one markdown doc, no slides needed)
// ---------------------------------------------------------------------------

export function mediaKit(p: {
  creator: string;
  niche: string;
  bio?: string;
  platforms: { name: string; handle: string; followers: string; avgViews?: string }[];
  pillars?: string[];
  pastBrands?: string;
  contact: string;
}): string {
  const rows = p.platforms
    .filter((x) => x.name.trim())
    .map((x) => `| ${x.name} | ${x.handle || "—"} | ${x.followers || "—"} | ${x.avgViews || "—"} |`)
    .join("\n");
  const pillars = (p.pillars ?? []).filter(Boolean);
  return [
    `# ${p.creator || "Creator"} — Media Kit`,
    ``,
    `**Niche:** ${p.niche || "—"}`,
    p.bio ? `\n${p.bio}\n` : ``,
    `## Audience & reach`,
    ``,
    `| Platform | Handle | Followers | Avg views |`,
    `|---|---|---|---|`,
    rows || `| — | — | — | — |`,
    ``,
    ...(pillars.length ? [`## Content pillars`, ``, ...pillars.map((x) => `- ${x}`), ``] : []),
    `## Ways to work together`,
    ``,
    `- **Integrated mention** — your product inside a regular video (highest trust)`,
    `- **Dedicated video** — full concept built around the product`,
    `- **Series** — 3–4 integrations across a month (best performance: audiences buy on repetition)`,
    `- **Usage rights** — license the content for your own ads`,
    ``,
    ...(p.pastBrands?.trim() ? [`## Past collaborations`, ``, p.pastBrands.trim(), ``] : []),
    `## Contact`,
    ``,
    `${p.contact || "—"}`,
    ``,
    `---`,
    `*Rates on request — every deal is scoped to deliverables and usage.*`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 8. Repurposing matrix (podcast-ops: one video → every platform),
//    wired to the app features that actually produce each artifact.
// ---------------------------------------------------------------------------

export interface RepurposeRow {
  platform: string;
  format: string;
  produceWith: string; // which app feature makes this artifact
  note: string;
}

export function repurposePlan(durationSec: number): RepurposeRow[] {
  const short = durationSec <= 65;
  const rows: RepurposeRow[] = [
    { platform: "TikTok / Reels / Shorts", format: "9:16 vertical, ≤60s", produceWith: short ? "Export → Save to device" : "Insights → Cut to length (15/30/60s)", note: "Post natively on each — cross-posted watermarks get downranked." },
    { platform: "YouTube", format: "16:9 wide", produceWith: "Export → More formats → Wide 16:9", note: "Use the Thumbnail A/B card for the cover, chapters from the Post kit." },
    { platform: "X / Threads", format: "1:1 square teaser", produceWith: "Export → More formats → Square 1:1", note: "First 2 lines of the caption carry the hook — no hashtags needed." },
    { platform: "LinkedIn", format: "1:1 square, captions burned", produceWith: "Editor → Captions (watch-muted mode)", note: "80%+ watch muted here — kinetic captions are the audio." },
    { platform: "Blog / newsletter", format: "Show notes + stills", produceWith: "Export → Post kit → Show notes (.md)", note: "The chapters become the article outline; thumbnails become inline images." },
  ];
  if (durationSec > 300) {
    rows.unshift({ platform: "Clips channel", format: "3–5 ranked shorts", produceWith: "Pro Tools → Long Recording → Shorts", note: "Each candidate window is already scored — post best-first." });
  }
  return rows;
}
