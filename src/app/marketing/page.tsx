"use client";

// Marketing HQ — creator GTM tools, all on-device, no accounts.
// Playbooks adapted for creators from the open-source ai-marketing-skills
// collection (github.com/ericosiu/ai-marketing-skills); implementations are
// original and local. Every tool is a generator or checklist the creator
// can act on today — no dashboards pretending to have data they don't.
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, CalendarDays, Check, Copy, Download, FlaskConical, Handshake,
  IdCard, Link2, Megaphone, Recycle, SearchCheck, Type, ChevronDown,
} from "lucide-react";
import { useProject } from "@/store/project";
import {
  slopCheck, optimizeTitle, contentCalendar, utmLink, abExperimentPlan,
  sponsorPitch, mediaKit, repurposePlan,
  type SlopReport, type TitleReport, type CalendarSlot, type ExperimentPlan, type SponsorPitch,
} from "@/lib/marketing";
import { planDuration } from "@/lib/retention";

function Section({ icon, title, children, startOpen = false }: { icon: React.ReactNode; title: string; children: React.ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="border-b border-card-border last:border-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-3 text-sm font-semibold">
        <span className="flex items-center gap-2">{icon} {title}</span>
        <ChevronDown size={14} className={`text-neutral-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

const input = "w-full rounded-lg border border-card-border bg-black px-3 py-2 text-xs outline-none placeholder:text-neutral-700 focus:border-accent";
const btnAccent = "rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-40";
const btnPlain = "rounded-full border border-card-border px-3 py-1.5 text-xs text-neutral-300 disabled:opacity-40";

export default function MarketingPage() {
  const router = useRouter();
  const { blueprint, plan } = useProject();
  const nicheLabel = blueprint?.niche?.label ?? "";
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };
  const download = (name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // slop check
  const [caption, setCaption] = useState("");
  const [slop, setSlop] = useState<SlopReport | null>(null);

  // title optimizer
  const [title, setTitle] = useState("");
  const [titleReport, setTitleReport] = useState<TitleReport | null>(null);
  const [titleSeed, setTitleSeed] = useState(1);

  // calendar
  const [topic, setTopic] = useState(nicheLabel);
  const [calSeed, setCalSeed] = useState(1);
  const [calendar, setCalendar] = useState<CalendarSlot[][]>([]);

  // utm
  const [utm, setUtm] = useState({ base: "", source: "tiktok", campaign: "" });
  const [utmOut, setUtmOut] = useState<string | null>(null);
  const [utmErr, setUtmErr] = useState<string | null>(null);

  // A/B
  const [abWhat, setAbWhat] = useState<"hook" | "thumbnail" | "title" | "cta">("hook");
  const [abVariants, setAbVariants] = useState("");
  const [abViews, setAbViews] = useState("500");
  const [abPlan, setAbPlan] = useState<ExperimentPlan | null>(null);

  // sponsor pitch
  const [pitch, setPitch] = useState({ creator: "", brand: "", followers: "", avgViews: "", angle: "" });
  const [pitchOut, setPitchOut] = useState<SponsorPitch | null>(null);

  // media kit
  const [kit, setKit] = useState({
    creator: "", bio: "", contact: "", pastBrands: "",
    p1: { name: "TikTok", handle: "", followers: "", avgViews: "" },
    p2: { name: "Instagram", handle: "", followers: "", avgViews: "" },
    p3: { name: "YouTube", handle: "", followers: "", avgViews: "" },
  });

  const calMarkdown = (weeks: CalendarSlot[][]) =>
    weeks
      .map(
        (w, i) =>
          `## Week ${i + 1}\n\n| Day | Format | Angle | CTA | Best time |\n|---|---|---|---|---|\n` +
          w.map((s) => `| ${s.day} | ${s.format} | ${s.angle} | ${s.cta} | ${s.bestTime} |`).join("\n")
      )
      .join("\n\n");

  return (
    <main className="flex flex-1 flex-col px-6 pb-10 pt-10">
      <header className="mb-4">
        <button onClick={() => router.back()} className="mb-3 flex items-center gap-1 text-xs text-neutral-500">
          <ArrowLeft size={13} /> back
        </button>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Marketing HQ</p>
        <h1 className="mt-1 text-2xl font-extrabold">Get the edit seen 📣</h1>
        <p className="mt-1 text-sm leading-6 text-neutral-400">
          Creator GTM playbooks — calendar, experiments, sponsor outreach, attribution. Everything runs on your device.
        </p>
      </header>

      <section className="card px-4 py-1">
        <Section icon={<SearchCheck size={14} className="text-accent" />} title="Caption Slop Check (humanizer)" startOpen>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder="Paste your caption / post text…" className={input} />
          <button className={`${btnAccent} mt-1.5`} disabled={caption.trim().length < 10} onClick={() => setSlop(slopCheck(caption))}>
            Check it
          </button>
          {slop && (
            <div className="mt-2 rounded-lg border border-card-border p-3">
              <p className="text-sm font-bold">
                <span className={slop.score >= 86 ? "text-green-400" : slop.score >= 58 ? "text-yellow-400" : "text-red-400"}>{slop.score}/100 human</span>
                <span className="ml-2 text-xs font-normal text-neutral-400">{slop.verdict}</span>
              </p>
              {slop.flags.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {slop.flags.map((f, i) => (
                    <li key={i} className="text-[11px] leading-4 text-neutral-400">
                      <span className="text-red-400">“{f.phrase}”</span> — {f.why}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        <Section icon={<Type size={14} className="text-accent" />} title="Title & Hook Optimizer">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your working title…" className={input} />
          <button
            className={`${btnAccent} mt-1.5`}
            disabled={title.trim().length < 4}
            onClick={() => {
              const s = titleSeed + 1;
              setTitleSeed(s);
              setTitleReport(optimizeTitle(title, s));
            }}
          >
            {titleReport ? "Rescore / reroll" : "Score it"}
          </button>
          {titleReport && (
            <div className="mt-2 rounded-lg border border-card-border p-3 text-xs">
              <p className="text-sm font-bold text-accent">{titleReport.score}/100</p>
              {titleReport.tips.map((t, i) => (
                <p key={i} className="mt-1 text-[11px] leading-4 text-neutral-400">• {t}</p>
              ))}
              <p className="mb-1 mt-2 text-[10px] uppercase tracking-wider text-neutral-600">Rewrites to steal</p>
              {titleReport.rewrites.map((r, i) => (
                <p key={i} className="mt-0.5 flex items-start justify-between gap-2 text-neutral-200">
                  <span>{r}</span>
                  <button onClick={() => copy(`rw${i}`, r)} className="shrink-0 p-0.5 text-neutral-600" aria-label={`Copy rewrite ${i + 1}`}>
                    {copied === `rw${i}` ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  </button>
                </p>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<CalendarDays size={14} className="text-accent" />} title="Content Calendar (2 weeks)">
          <div className="flex items-center gap-1.5">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={nicheLabel || "your topic (e.g. street food)"} className={input} />
            <button
              className={btnAccent}
              onClick={() => {
                const s = calSeed + 1;
                setCalSeed(s);
                setCalendar(contentCalendar(topic.trim() || nicheLabel || "your niche", { seed: s }));
              }}
            >
              {calendar.length ? "Reroll" : "Plan it"}
            </button>
          </div>
          {calendar.map((week, wi) => (
            <div key={wi} className="mt-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-600">Week {wi + 1}</p>
              <div className="space-y-1.5">
                {week.map((s, i) => (
                  <div key={i} className="rounded-lg border border-card-border px-3 py-2 text-xs">
                    <span className="font-bold text-accent">{s.day}</span>
                    <span className="ml-2 font-semibold text-neutral-200">{s.format}</span>
                    <span className="ml-2 text-neutral-500">{s.bestTime}</span>
                    <p className="mt-0.5 text-[11px] leading-4 text-neutral-400">{s.angle}</p>
                    <p className="text-[10px] text-neutral-600">CTA: {s.cta}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {calendar.length > 0 && (
            <button className={`${btnPlain} mt-2`} onClick={() => copy("cal", calMarkdown(calendar))}>
              {copied === "cal" ? "Copied!" : "Copy as markdown"}
            </button>
          )}
        </Section>

        <Section icon={<Link2 size={14} className="text-accent" />} title="UTM Link Builder">
          <div className="space-y-1.5">
            <input value={utm.base} onChange={(e) => setUtm({ ...utm, base: e.target.value })} placeholder="Link to tag (your shop, newsletter…)" className={input} />
            <div className="flex gap-1.5">
              <input value={utm.source} onChange={(e) => setUtm({ ...utm, source: e.target.value })} placeholder="source (tiktok)" className={input} />
              <input value={utm.campaign} onChange={(e) => setUtm({ ...utm, campaign: e.target.value })} placeholder="campaign (launch-week)" className={input} />
            </div>
            <button
              className={btnAccent}
              disabled={!utm.base.trim()}
              onClick={() => {
                const r = utmLink(utm.base, { source: utm.source, campaign: utm.campaign });
                if (r.ok) {
                  setUtmOut(r.url);
                  setUtmErr(null);
                } else {
                  setUtmErr(r.error);
                  setUtmOut(null);
                }
              }}
            >
              Build link
            </button>
            {utmErr && <p className="text-[11px] text-red-400">{utmErr}</p>}
            {utmOut && (
              <p className="flex items-start justify-between gap-2 rounded-lg bg-black px-3 py-2 font-mono text-[10px] leading-4 text-neutral-300">
                <span className="break-all">{utmOut}</span>
                <button onClick={() => copy("utm", utmOut)} className="shrink-0 p-0.5 text-neutral-500" aria-label="Copy UTM link">
                  {copied === "utm" ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                </button>
              </p>
            )}
            <p className="text-[10px] text-neutral-600">Now your analytics can tell WHICH video and platform sent the click.</p>
          </div>
        </Section>

        <Section icon={<FlaskConical size={14} className="text-accent" />} title="A/B Experiment Planner">
          <div className="flex gap-1.5">
            <select value={abWhat} onChange={(e) => setAbWhat(e.target.value as typeof abWhat)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
              <option value="hook">Hook</option>
              <option value="thumbnail">Thumbnail</option>
              <option value="title">Title</option>
              <option value="cta">CTA</option>
            </select>
            <input value={abViews} onChange={(e) => setAbViews(e.target.value.replace(/\D/g, ""))} placeholder="views/day" className={`${input} w-28`} />
          </div>
          <textarea
            value={abVariants}
            onChange={(e) => setAbVariants(e.target.value)}
            rows={2}
            placeholder={"One variant per line, e.g.\nTight open\nEnding-first teaser"}
            className={`${input} mt-1.5`}
          />
          <button
            className={`${btnAccent} mt-1.5`}
            onClick={() => setAbPlan(abExperimentPlan({ what: abWhat, variants: abVariants.split("\n"), dailyViews: parseInt(abViews || "500", 10) }))}
          >
            Plan the test
          </button>
          {abPlan === null && abVariants.trim() && <p className="mt-1 text-[11px] text-neutral-500">Give it at least two variants.</p>}
          {abPlan && (
            <div className="mt-2 space-y-1 rounded-lg border border-card-border p-3 text-[11px] leading-4 text-neutral-300">
              <p><span className="text-neutral-600">Hypothesis:</span> {abPlan.hypothesis}</p>
              <p><span className="text-neutral-600">Measure:</span> {abPlan.metric}</p>
              <p><span className="text-neutral-600">Guardrail:</span> {abPlan.guardrail}</p>
              <p><span className="text-neutral-600">How:</span> {abPlan.split}</p>
              <p><span className="text-neutral-600">Run:</span> ~{abPlan.durationDays} days ({abPlan.minPerVariant.toLocaleString()} views per variant)</p>
              <p><span className="text-neutral-600">Decide:</span> {abPlan.decisionRule}</p>
              <p className="pt-1 text-[10px] text-neutral-600">Tip: the Insights panel already generates hook variants, and the Export page scores thumbnails — those are your variants.</p>
            </div>
          )}
        </Section>

        <Section icon={<Handshake size={14} className="text-accent" />} title="Sponsor Pitch (brand outreach)">
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <input value={pitch.creator} onChange={(e) => setPitch({ ...pitch, creator: e.target.value })} placeholder="Your name" className={input} />
              <input value={pitch.brand} onChange={(e) => setPitch({ ...pitch, brand: e.target.value })} placeholder="Brand" className={input} />
            </div>
            <div className="flex gap-1.5">
              <input value={pitch.followers} onChange={(e) => setPitch({ ...pitch, followers: e.target.value })} placeholder="Followers (e.g. 42k)" className={input} />
              <input value={pitch.avgViews} onChange={(e) => setPitch({ ...pitch, avgViews: e.target.value })} placeholder="Avg views" className={input} />
            </div>
            <input value={pitch.angle} onChange={(e) => setPitch({ ...pitch, angle: e.target.value })} placeholder="Your one concrete idea (optional but powerful)" className={input} />
            <button
              className={btnAccent}
              disabled={!pitch.brand.trim()}
              onClick={() =>
                setPitchOut(
                  sponsorPitch({ creator: pitch.creator, niche: nicheLabel || topic || "creator", followers: pitch.followers, avgViews: pitch.avgViews, brand: pitch.brand, angle: pitch.angle })
                )
              }
            >
              Write the pitch
            </button>
          </div>
          {pitchOut && (
            <div className="mt-2 rounded-lg border border-card-border p-3 text-xs">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-600">Subject lines</p>
              {pitchOut.subjects.map((s, i) => (
                <p key={i} className="text-neutral-300">• {s}</p>
              ))}
              <p className="mb-1 mt-2 text-[10px] uppercase tracking-wider text-neutral-600">Email</p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-black px-3 py-2 text-[11px] leading-4 text-neutral-300">{pitchOut.email}</pre>
              <p className="mb-1 mt-2 text-[10px] uppercase tracking-wider text-neutral-600">Follow-ups</p>
              {pitchOut.followUps.map((f, i) => (
                <p key={i} className="text-[11px] leading-4 text-neutral-400">Day {f.day}: {f.message}</p>
              ))}
              <button className={`${btnPlain} mt-2`} onClick={() => copy("pitch", `${pitchOut.subjects[0]}\n\n${pitchOut.email}`)}>
                {copied === "pitch" ? "Copied!" : "Copy subject + email"}
              </button>
            </div>
          )}
        </Section>

        <Section icon={<IdCard size={14} className="text-accent" />} title="Media Kit Builder">
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <input value={kit.creator} onChange={(e) => setKit({ ...kit, creator: e.target.value })} placeholder="Creator / channel name" className={input} />
              <input value={kit.contact} onChange={(e) => setKit({ ...kit, contact: e.target.value })} placeholder="Contact (email)" className={input} />
            </div>
            <input value={kit.bio} onChange={(e) => setKit({ ...kit, bio: e.target.value })} placeholder="One-line bio" className={input} />
            {(["p1", "p2", "p3"] as const).map((k) => (
              <div key={k} className="flex gap-1.5">
                <input value={kit[k].name} onChange={(e) => setKit({ ...kit, [k]: { ...kit[k], name: e.target.value } })} placeholder="Platform" className={`${input} w-24`} />
                <input value={kit[k].handle} onChange={(e) => setKit({ ...kit, [k]: { ...kit[k], handle: e.target.value } })} placeholder="@handle" className={input} />
                <input value={kit[k].followers} onChange={(e) => setKit({ ...kit, [k]: { ...kit[k], followers: e.target.value } })} placeholder="Followers" className={`${input} w-24`} />
                <input value={kit[k].avgViews} onChange={(e) => setKit({ ...kit, [k]: { ...kit[k], avgViews: e.target.value } })} placeholder="Avg views" className={`${input} w-24`} />
              </div>
            ))}
            <input value={kit.pastBrands} onChange={(e) => setKit({ ...kit, pastBrands: e.target.value })} placeholder="Past brand collabs (optional)" className={input} />
            <button
              className={btnAccent}
              disabled={!kit.creator.trim()}
              onClick={() =>
                download(
                  "media-kit.md",
                  mediaKit({
                    creator: kit.creator,
                    niche: nicheLabel || topic || "—",
                    bio: kit.bio,
                    platforms: [kit.p1, kit.p2, kit.p3],
                    pastBrands: kit.pastBrands,
                    contact: kit.contact,
                  })
                )
              }
            >
              <span className="flex items-center gap-1"><Download size={12} /> Download media kit (.md)</span>
            </button>
            <p className="text-[10px] text-neutral-600">Markdown pastes clean into Notion/Docs — export to PDF from there for brands.</p>
          </div>
        </Section>

        <Section icon={<Recycle size={14} className="text-accent" />} title="Repurposing Map (one edit → every platform)">
          <div className="space-y-1.5">
            {repurposePlan(plan ? planDuration(plan) : 60).map((r, i) => (
              <div key={i} className="rounded-lg border border-card-border px-3 py-2 text-xs">
                <span className="font-semibold text-neutral-200">{r.platform}</span>
                <span className="ml-2 text-neutral-500">{r.format}</span>
                <p className="mt-0.5 text-[11px] text-accent">{r.produceWith}</p>
                <p className="text-[10px] leading-4 text-neutral-600">{r.note}</p>
              </div>
            ))}
          </div>
        </Section>
      </section>

      <p className="mt-4 flex items-center gap-1.5 text-[10px] leading-4 text-neutral-600">
        <Megaphone size={11} className="shrink-0" />
        Playbook structure adapted from the open-source ai-marketing-skills collection; all generators run locally — nothing you type leaves this device.
      </p>
    </main>
  );
}
