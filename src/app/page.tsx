import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookMarked,
  BookOpen,
  Brain,
  Calculator,
  ClipboardCheck,
  FileSpreadsheet,
  Landmark,
  Layers,
  LayoutTemplate,
  Lightbulb,
  ListChecks,
  Mic,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";

/* ─── Mock data for the dashboard preview ─── */

const quarterlyPubs = [
  { q: "Q1", value: 42, color: "bg-brand" },
  { q: "Q2", value: 67, color: "bg-indigo-500" },
  { q: "Q3", value: 51, color: "bg-brand" },
  { q: "Q4", value: 89, color: "bg-indigo-500" },
];

const grantBars = [
  { name: "DST-SERB", pct: 67, amount: "₹1.2Cr / ₹1.8Cr", color: "bg-brand" },
  { name: "UGC Major", pct: 71, amount: "₹85L / ₹1.2Cr", color: "bg-indigo-500" },
  { name: "ICSSR", pct: 44, amount: "₹32L / ₹72L", color: "bg-amber-500" },
];

const scoreCards = [
  { label: "NAAC Score", value: "3.41", sub: "/ 4.00", color: "text-brand" },
  { label: "NIRF Rank", value: "#42", sub: "↑ 6 places", color: "text-indigo-600" },
  { label: "Publications", value: "234", sub: "this year", color: "text-violet-600" },
  { label: "Patents", value: "18", sub: "filed", color: "text-amber-600" },
];

const platformStats = [
  { value: "150+", label: "Institutions", color: "text-brand" },
  { value: "50,000+", label: "KPIs Tracked", color: "text-indigo-600" },
  { value: "12,000+", label: "Publications", color: "text-violet-600" },
  { value: "₹200Cr+", label: "Grants Managed", color: "text-amber-600" },
];

/* ─── Feature content ─── */

const pillars = [
  {
    icon: Target,
    title: "Allocate & Plan",
    accent: "border-t-brand bg-brand/8 text-brand",
    description:
      "Assign KRAs and KPIs across departments using accreditation-mapped templates. Prevent gaps, avoid duplication.",
  },
  {
    icon: BarChart3,
    title: "Track & Measure",
    accent: "border-t-indigo-500 bg-indigo-50 text-indigo-600",
    description:
      "Monitor data collection in real time with auto score calculations. No more manual spreadsheet reconciliation.",
  },
  {
    icon: TrendingUp,
    title: "Analyze & Improve",
    accent: "border-t-amber-500 bg-amber-50 text-amber-600",
    description:
      "AI-powered recommendations pinpoint weak areas and suggest targeted actions to lift scores before the next cycle.",
  },
];

const capabilities = [
  {
    icon: LayoutTemplate,
    title: "Accreditation-Mapped Templates",
    description: "Ready-to-use KRA & KPI templates aligned to NAAC, NIRF, NBA, and other frameworks.",
    dot: "bg-brand",
  },
  {
    icon: FileSpreadsheet,
    title: "Auto DVV Generation",
    description: "Automatically generate Data Verification & Validation documents from tracked metrics.",
    dot: "bg-indigo-500",
  },
  {
    icon: ClipboardCheck,
    title: "Accreditation Planning",
    description: "Plan full accreditation cycles with milestones, deadlines, and responsibility mapping.",
    dot: "bg-violet-500",
  },
  {
    icon: ListChecks,
    title: "Smart Data Allocation",
    description: "Route collection tasks to the right teams. Avoid errors and missed criteria.",
    dot: "bg-amber-500",
  },
  {
    icon: Calculator,
    title: "Auto Score Calculation",
    description: "Scores update as data flows in. Know where your institution stands at any point.",
    dot: "bg-brand",
  },
  {
    icon: Brain,
    title: "AI Recommendations",
    description: "Intelligent suggestions for score improvement based on patterns and peer benchmarks.",
    dot: "bg-indigo-500",
  },
  {
    icon: Trophy,
    title: "Competition Analysis",
    description: "Benchmark against peer institutions and ranking parameters to find your edge.",
    dot: "bg-violet-500",
  },
  {
    icon: Activity,
    title: "Progress Monitoring",
    description: "Track completion rates, pending submissions, and overall readiness from one view.",
    dot: "bg-amber-500",
  },
];

const researchOutputs = [
  {
    icon: BookOpen,
    title: "Journal Articles",
    description: "SCI, Scopus, and UGC-indexed publications with citation metrics and impact factors.",
    color: "bg-brand/10 text-brand",
  },
  {
    icon: Mic,
    title: "Conference Papers",
    description: "Submissions, acceptances, and proceedings across national and international conferences.",
    color: "bg-indigo-50 text-indigo-600",
  },
  {
    icon: BookMarked,
    title: "Book Chapters",
    description: "Authored, edited, and contributed chapters with publisher and ISBN tracking.",
    color: "bg-violet-50 text-violet-600",
  },
  {
    icon: Lightbulb,
    title: "Patents",
    description: "Filed, published, and granted patents with application stage and IP status.",
    color: "bg-amber-50 text-amber-600",
  },
  {
    icon: Landmark,
    title: "Grants & Funding",
    description: "Proposals, sanctions, disbursements, and utilization across funding agencies.",
    color: "bg-rose-50 text-rose-600",
  },
  {
    icon: Layers,
    title: "Stage Tracking",
    description: "Pipeline view from draft to published — every output tracked through its lifecycle.",
    color: "bg-emerald-50 text-emerald-600",
  },
];

const frameworks = ["NAAC", "NIRF", "NBA", "ABET", "QS Rankings", "THE"];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      {/* ── Nav ── */}
      <nav className="animate-fade-in-up mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <div className="animate-pulse-ring flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
            <Target className="h-4.5 w-4.5" />
          </div>
          <span className="text-base font-bold tracking-tight text-slate-900">
            AcademetriQ
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="hidden rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/30 sm:inline-flex"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 pt-10 pb-8 text-center sm:px-8 sm:pt-16 sm:pb-12">
        <div
          className="animate-fade-in-up mb-6 inline-flex items-center gap-2 rounded-full border border-brand/15 bg-brand/5 px-4 py-1.5"
          style={{ animationDelay: "0.1s" }}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
            KPI Intelligence for Academic Excellence
          </span>
        </div>
        <h1
          className="animate-fade-in-up mx-auto max-w-4xl font-[family-name:var(--font-geist-mono)] text-[2.5rem] leading-[1.1] tracking-tight text-slate-950 sm:text-5xl lg:text-[3.75rem]"
          style={{ animationDelay: "0.2s" }}
        >
          Measure what matters.{" "}
          <span className="gradient-text">Improve what counts.</span>
        </h1>
        <p
          className="animate-fade-in-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-500"
          style={{ animationDelay: "0.3s" }}
        >
          Allocate responsibilities, track accreditation data, monitor research
          output, calculate scores automatically, and strengthen weak areas —
          all from one intelligent platform.
        </p>
        <div
          className="animate-fade-in-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
          style={{ animationDelay: "0.4s" }}
        >
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition hover:bg-brand/90 hover:shadow-xl hover:shadow-brand/30"
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/workspace"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-7 py-3.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 hover:shadow-md"
          >
            View live demo
          </Link>
        </div>
      </section>

      {/* ── Dashboard Mockup ── */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <div
          className="animate-fade-in-up animate-float mx-auto max-w-5xl"
          style={{ animationDelay: "0.6s" }}
        >
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_25px_60px_-12px_rgba(15,118,110,0.12),0_25px_50px_-12px_rgba(99,102,241,0.08)]">
            {/* Window chrome */}
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-rose-400" />
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <div className="h-3 w-3 rounded-full bg-emerald-400" />
              </div>
              <div className="ml-4 flex-1">
                <div className="mx-auto max-w-xs rounded-md border border-slate-200/60 bg-white/80 px-3 py-1 text-center text-[11px] text-slate-400">
                  academetriq.app/dashboard
                </div>
              </div>
            </div>

            {/* Dashboard body */}
            <div className="flex min-h-[360px]">
              {/* Sidebar — org hierarchy */}
              <div className="hidden w-52 shrink-0 border-r border-slate-100 bg-slate-50/40 p-4 lg:block">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Organization
                </div>
                <div className="space-y-0.5 text-[12px]">
                  <div className="flex items-center gap-1.5 rounded-md bg-brand/8 px-2 py-1 font-semibold text-slate-800">
                    <span className="text-brand">▾</span> University
                  </div>
                  <div className="ml-3 space-y-0.5">
                    <div className="flex items-center gap-1.5 rounded-md bg-indigo-50/80 px-2 py-1 font-medium text-slate-700">
                      <span className="text-indigo-500">▾</span> Engineering
                    </div>
                    <div className="ml-5 space-y-px text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 transition hover:bg-slate-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                        Computer Science
                      </div>
                      <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 transition hover:bg-slate-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        Electronics &amp; Comm.
                      </div>
                      <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 transition hover:bg-slate-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Mechanical
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 text-slate-500">
                      <span className="text-slate-300">▸</span> Science
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 text-slate-500">
                      <span className="text-slate-300">▸</span> Management
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 text-slate-500">
                      <span className="text-slate-300">▸</span> Law
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 text-slate-500">
                      <span className="text-slate-300">▸</span> Humanities
                    </div>
                  </div>
                </div>
              </div>

              {/* Main dashboard content */}
              <div className="flex-1 space-y-3 p-4">
                {/* Score cards row */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {scoreCards.map((s, i) => (
                    <div
                      key={s.label}
                      className="animate-fade-in-up rounded-xl border border-slate-100 bg-white p-3 shadow-sm"
                      style={{ animationDelay: `${0.8 + i * 0.1}s` }}
                    >
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {s.label}
                      </div>
                      <div className={`text-xl font-bold ${s.color}`}>
                        {s.value}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {s.sub}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Publications by Quarter */}
                  <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Publications by Quarter
                    </div>
                    <div className="flex items-end gap-3" style={{ height: 100 }}>
                      {quarterlyPubs.map((d, i) => (
                        <div
                          key={d.q}
                          className="flex flex-1 flex-col items-center gap-1.5"
                        >
                          <div className="relative w-full">
                            <div
                              className={`animate-bar-grow w-full rounded-t-md ${d.color}`}
                              style={{
                                height: `${(d.value / 89) * 100}px`,
                                animationDelay: `${1.2 + i * 0.15}s`,
                              }}
                            />
                          </div>
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] font-semibold text-slate-600">
                              {d.value}
                            </span>
                            <span className="text-[9px] text-slate-400">
                              {d.q}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Grant Utilization */}
                  <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Grant Utilization
                    </div>
                    <div className="space-y-3">
                      {grantBars.map((g, i) => (
                        <div key={g.name}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-700">
                              {g.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {g.amount}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`animate-progress h-full rounded-full ${g.color}`}
                              style={{
                                width: `${g.pct}%`,
                                animationDelay: `${1.5 + i * 0.2}s`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Research output mini row */}
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {[
                    { label: "Journals", count: "147", color: "text-brand" },
                    { label: "Conferences", count: "89", color: "text-indigo-600" },
                    { label: "Books", count: "23", color: "text-violet-600" },
                    { label: "Patents", count: "18", color: "text-amber-600" },
                    { label: "Grants", count: "31", color: "text-rose-600" },
                    { label: "In Review", count: "42", color: "text-emerald-600" },
                  ].map((r) => (
                    <div
                      key={r.label}
                      className="rounded-lg border border-slate-100 bg-slate-50/50 px-2 py-2 text-center"
                    >
                      <div className={`text-sm font-bold ${r.color}`}>
                        {r.count}
                      </div>
                      <div className="text-[9px] text-slate-400">{r.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats Ribbon ── */}
      <section className="border-y border-slate-100 bg-white">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 sm:px-8 md:grid-cols-4 md:gap-0 md:divide-x md:divide-slate-100">
          {platformStats.map((s, i) => (
            <div
              key={s.label}
              className="animate-fade-in-up text-center"
              style={{ animationDelay: `${0.2 + i * 0.1}s` }}
            >
              <div
                className={`font-[family-name:var(--font-geist-mono)] text-3xl font-bold tracking-tight sm:text-4xl ${s.color}`}
              >
                {s.value}
              </div>
              <div className="mt-1 text-sm text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Three Pillars ── */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:px-8">
        <div className="grid gap-5 md:grid-cols-3">
          {pillars.map((p, i) => {
            const [borderClass, bgClass, textClass] = p.accent.split(" ");
            return (
              <div
                key={p.title}
                className={`animate-fade-in-up rounded-2xl border border-t-[3px] border-slate-100 bg-white p-7 transition hover:shadow-md ${borderClass}`}
                style={{ animationDelay: `${0.1 + i * 0.12}s` }}
              >
                <div
                  className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl ${bgClass} ${textClass}`}
                >
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-base font-semibold text-slate-900">
                  {p.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-500">
                  {p.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Framework alignment ── */}
      <section className="mx-auto max-w-5xl px-6 pb-16 sm:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-8 py-5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            Aligned with
          </span>
          {frameworks.map((f) => (
            <span
              key={f}
              className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold tracking-wide text-slate-500"
            >
              {f}
            </span>
          ))}
        </div>
      </section>

      {/* ── Accreditation Capabilities ── */}
      <section className="mx-auto max-w-5xl px-6 pb-24 sm:px-8">
        <div className="mb-10 text-center">
          <h2 className="font-[family-name:var(--font-geist-mono)] text-2xl tracking-tight text-slate-950 sm:text-3xl">
            Everything accreditation demands
          </h2>
          <p className="mt-3 text-base text-slate-500">
            No clutter. No guesswork. Just the tools your institution needs.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((cap, i) => (
            <div
              key={cap.title}
              className="animate-fade-in-up group rounded-2xl border border-slate-100 bg-white p-6 transition hover:border-brand/20 hover:shadow-md"
              style={{ animationDelay: `${0.05 + i * 0.06}s` }}
            >
              <div className="mb-4 flex items-center gap-2.5">
                <div className={`h-2 w-2 rounded-full ${cap.dot}`} />
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-400 transition group-hover:bg-brand/8 group-hover:text-brand">
                  <cap.icon className="h-[18px] w-[18px]" />
                </div>
              </div>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-900">
                {cap.title}
              </h3>
              <p className="text-[13px] leading-relaxed text-slate-500">
                {cap.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Research Output Tracking ── */}
      <section className="border-y border-slate-100 bg-gradient-to-b from-slate-50/80 to-white">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:px-8 sm:py-24">
          <div className="mb-10 text-center">
            <h2 className="font-[family-name:var(--font-geist-mono)] text-2xl tracking-tight text-slate-950 sm:text-3xl">
              Research output, fully tracked
            </h2>
            <p className="mt-3 text-base text-slate-500">
              From draft to publication — every journal, conference, patent, and
              grant tracked through its full lifecycle.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {researchOutputs.map((item, i) => (
              <div
                key={item.title}
                className="animate-fade-in-up group flex gap-4 rounded-2xl border border-slate-100 bg-white p-6 transition hover:border-brand/15 hover:shadow-md"
                style={{ animationDelay: `${0.05 + i * 0.08}s` }}
              >
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.color}`}
                >
                  <item.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="mb-1 text-sm font-semibold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-slate-500">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center sm:px-8 sm:py-24">
          <h2 className="font-[family-name:var(--font-geist-mono)] text-2xl tracking-tight text-white sm:text-3xl">
            Built for institutions that take rankings seriously
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-slate-400">
            Adaptive to your accreditation framework. Reliable across review
            cycles. Ready from day one.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition hover:bg-brand/90 hover:shadow-xl"
            >
              Start tracking KPIs
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/workspace"
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-7 py-3.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Explore the platform
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-8 text-center sm:px-8">
          <p className="text-xs text-slate-400">
            &copy; {new Date().getFullYear()} AcademetriQ. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
