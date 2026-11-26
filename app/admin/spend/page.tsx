import { AlertTriangle, CheckCircle2, CircleOff } from "lucide-react";
import { buildSpendReport, monthRange, type ElevenCredits, type ProviderSection, type SpendReport, type SpendRow } from "@/lib/spend/report";
import { prisma } from "@/lib/prisma";
import { SpendMonth } from "@/components/admin/spend-month";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";

// Admin → Spend (docs/voice-spend.md): the month's voice spend, ElevenLabs and Deepgram, from the platform's own ledger
// of every billable call, checked against what each provider reports for the platform's key. ElevenLabs in credits,
// what its plan and dashboard count.

const usd = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "–" : value > 0 && value < 0.01 && digits <= 2 ? "< US$0.01" : `US$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const count = (value: number) => value.toLocaleString("en-US");
const minutes = (seconds: number) => (seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";
const credits = (value: number) => `${Math.round(value).toLocaleString("en-US")} credits`;
const MODEL = { eleven_v4: "Eleven v4", eleven_flash_v2_5: "Flash v2.5", eleven_multilingual_v2: "Multilingual v2", eleven_v3: "Eleven v3", scribe_v2: "Scribe v2" } as Record<string, string>;
const modelName = (model: string) => MODEL[model] ?? model.replace(/^eleven_/, "").replaceAll("_", " ");
// One color per key in the hourly chart, the platform's first.
const KEY_COLORS = ["bg-foreground/75", "bg-sky-500/75", "bg-amber-500/75", "bg-emerald-500/75", "bg-violet-500/75", "bg-rose-500/75"];
const NAME = { elevenlabs: "ElevenLabs", deepgram: "Deepgram" } as const;

export default async function SpendPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const month = (await searchParams).month;
  const [report, board] = await Promise.all([buildSpendReport(month), whiteboardMonth(month)]);
  return (
    <div className="flex h-full flex-1 flex-col gap-6 px-2 pb-12 md:px-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Voice spend</h2>
          <p className="max-w-3xl text-muted-foreground">
            Every billable call to ElevenLabs and Deepgram, as the platform logged it, checked against what each provider says the platform&apos;s key did and
            billed. A call the provider saw and the platform didn&apos;t log is flagged.
          </p>
        </div>
        <SpendMonth month={report.month} />
      </div>

      <Status report={report} />

      <dl className="grid gap-x-8 gap-y-4 rounded-xl border border-border bg-card px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Billed to the platform" value={usd(report.totals.billedUsd)} hint="What ElevenLabs and Deepgram charged the platform's keys this month." />
        <Figure
          label="ElevenLabs"
          value={credits(report.elevenCredits.billed)}
          hint={`${usd(report.providers.elevenlabs.billed.usd)} by ElevenLabs' figure · ${count(report.providers.elevenlabs.billed.requests)} requests`}
        />
        <Figure label="Deepgram" value={usd(report.providers.deepgram.billed.usd)} hint={`${count(report.providers.deepgram.billed.requests)} requests`} />
        <Figure
          label="Unaccounted"
          value={usd(report.totals.unaccountedUsd)}
          hint={
            report.totals.unaccountedRequests
              ? `${count(report.totals.unaccountedRequests)} calls the platform didn't log`
              : report.totals.unaccountedUsd > 0
                ? "Credits billed beyond those logged"
                : "Nothing the platform didn't log"
          }
          tone={report.totals.unaccountedRequests || report.totals.unaccountedUsd > 0.5 ? "attention" : "ok"}
        />
      </dl>

      {report.providers.elevenlabs.status !== "unavailable" && <ElevenLabsCredits data={report.elevenCredits} />}

      <div className="grid gap-5 xl:grid-cols-2">
        <Provider section={report.providers.elevenlabs} credits={report.elevenCredits} />
        <Provider section={report.providers.deepgram} />
      </div>

      <Section
        title="By workload"
        note="What each kind of work cost. Credits: ElevenLabs, each call's own figure. Billed: ElevenLabs shared out at the month's billed rate; Deepgram from its own log, by request or tag."
      >
        <Table rows={report.byWorkload.map((row) => ({ ...row, label: `${row.label} · ${NAME[row.provider]}` }))} />
      </Section>

      <Section
        title="Whiteboard"
        note="Lessons with Didactra's teacher this month (docs/whiteboard.md), by learner: the minutes and the cost Didactra reported (its model and voice, at list price). Its Deepgram calls are also in the tables above, by tag."
      >
        <Whiteboard rows={board} />
      </Section>

      <Section title="By day" note="Billed by each provider, by day (UTC), with ElevenLabs' credits.">
        <Days report={report} />
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="By course">
          <Table rows={report.byCourse} />
        </Section>
        <Section title="By voice">
          <Table rows={report.byVoice} />
        </Section>
        <Section title="Lessons that cost the most" note="Up to 50.">
          <Table rows={report.byLesson.slice(0, 15)} />
        </Section>
        <Section title="By user" note="Who asked: the admin for lesson audio, the learner for the tutor.">
          <Table rows={report.byUser} />
        </Section>
      </div>

      <Section title="Latest calls" note={`The last 40 of ${count(report.charges.length)}. Every call is in the CSV and JSON exports.`}>
        <Calls report={report} />
      </Section>
    </div>
  );
}

function Status({ report }: { report: SpendReport }) {
  const { status } = report.totals;
  if (status === "ok")
    return (
      <p className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
        Every call ElevenLabs and Deepgram billed to the platform&apos;s keys this month is one the platform logged.
      </p>
    );
  if (status === "unavailable")
    return (
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <CircleOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        A provider couldn&apos;t be read, so its spend can&apos;t be checked: see its panel below. The platform&apos;s own log is complete either way.
      </p>
    );
  const eleven = report.providers.elevenlabs;
  const deepgram = report.providers.deepgram;
  const findings = [
    eleven.unaccounted.requests ? `ElevenLabs: ${count(eleven.unaccounted.requests)} speech requests by the platform's key that the platform didn't log.` : null,
    eleven.unaccountedCredits
      ? `ElevenLabs: ${credits(eleven.unaccountedCredits)} more billed than the platform logged (${usd(eleven.unaccounted.usd)}), on days of per-call logging.`
      : null,
    deepgram.unaccounted.requests ? `Deepgram: ${count(deepgram.unaccounted.requests)} requests by the platform's key that the platform didn't make (${usd(deepgram.unaccounted.usd, 4)}).` : null,
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <div className="space-y-1">
        {findings.map((finding) => (
          <p key={finding} className="font-medium">
            {finding}
          </p>
        ))}
        <p>
          Each call is listed in its provider&apos;s panel below with what it most likely was. If you didn&apos;t make one yourself (a local test with the
          production key counts) and it isn&apos;t explained there, treat the key as leaked: rotate it in the provider&apos;s dashboard, then in Amplify and on
          the lab server.
        </p>
      </div>
    </div>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "ok" | "attention" }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-2xl font-semibold tabular-nums tracking-tight", tone === "attention" && "text-amber-700 dark:text-amber-300")}>{value}</dd>
      <dd className="text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

function Provider({ section, credits: creditFigures }: { section: ProviderSection; credits?: ElevenCredits }) {
  const name = NAME[section.provider];
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{name}</h3>
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-medium",
            section.status === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
            section.status === "attention" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
            section.status === "unavailable" && "border-border text-muted-foreground",
          )}
        >
          {section.status === "ok" ? "Accounted for" : section.status === "attention" ? "Needs a look" : "Couldn't be read"}
        </span>
      </div>
      {section.error && <p className="mt-2 text-sm text-destructive">{section.error}</p>}

      <table className="mt-4 w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-1 font-medium" />
            <th className="pb-1 text-right font-medium">{name} says</th>
            <th className="pb-1 text-right font-medium">The platform logged</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr>
            <td className="py-1.5 text-muted-foreground">Cost</td>
            <td className="py-1.5 text-right font-medium">{usd(section.billed.usd)}</td>
            <td className="py-1.5 text-right">
              <Tip content="Estimated when each call was made, at list price.">
                <span>{usd(section.logged.estimatedUsd)} est.</span>
              </Tip>
            </td>
          </tr>
          <tr>
            <td className="py-1.5 text-muted-foreground">Requests</td>
            <td className="py-1.5 text-right">{count(section.billed.requests)}</td>
            <td className="py-1.5 text-right">
              {count(section.logged.calls)}
              {section.logged.failedCalls ? <span className="text-muted-foreground"> ({count(section.logged.failedCalls)} failed)</span> : null}
            </td>
          </tr>
          {creditFigures && (
            <tr>
              <td className="py-1.5 text-muted-foreground">Credits</td>
              <td className="py-1.5 text-right font-medium">{count(creditFigures.billed)}</td>
              <td className="py-1.5 text-right">
                {count(creditFigures.logged)}
                {creditFigures.loggedEstimated > 0 && (
                  <Tip content={`${count(creditFigures.loggedEstimated)} of them estimated from characters, for calls whose response didn't say.`}>
                    <span className="text-muted-foreground"> ({count(creditFigures.loggedEstimated)} est.)</span>
                  </Tip>
                )}
              </td>
            </tr>
          )}
          {!creditFigures && section.logged.characters > 0 && (
            <tr>
              <td className="py-1.5 text-muted-foreground">Characters</td>
              <td className="py-1.5 text-right text-muted-foreground">–</td>
              <td className="py-1.5 text-right">{count(section.logged.characters)}</td>
            </tr>
          )}
          {section.billed.characters !== null && (
            <tr>
              <td className="py-1.5 text-muted-foreground">Characters</td>
              <td className="py-1.5 text-right">{count(section.billed.characters)}</td>
              <td className="py-1.5 text-right">{count(section.logged.characters)}</td>
            </tr>
          )}
          {section.logged.audioSeconds > 0 && (
            <tr>
              <td className="py-1.5 text-muted-foreground">Audio</td>
              <td className="py-1.5 text-right text-muted-foreground">–</td>
              <td className="py-1.5 text-right">{minutes(section.logged.audioSeconds)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-muted-foreground">
        {section.billedPer1000 !== null && (
          <>
            ElevenLabs puts {usd(section.billedPer1000, 3)} on 1,000 credits this month (its figure; the plan is paid ahead).{" "}
          </>
        )}
        {section.balanceUsd !== null && <>Credit left in the project: {usd(section.balanceUsd)}. </>}
        {section.ledgerSince ? <>Per-call logging since {when(section.ledgerSince)}.</> : <>No call logged one by one yet this month.</>}
      </p>
      {section.notes.map((note) => (
        <p key={note} className="mt-1 text-xs text-muted-foreground">
          {note}
        </p>
      ))}

      {section.unaccounted.items.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Not made by the platform ({count(section.unaccounted.items.length)})</h4>
          <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-amber-500/40 text-xs">
            {section.unaccounted.items.slice(0, 100).map((item) => (
              <li key={item.requestId} className="space-y-0.5 px-3 py-1.5 tabular-nums">
                <div className="flex flex-wrap gap-x-3">
                  <span className="font-medium">{when(item.at)}</span>
                  <span>{item.kind}</span>
                  {item.latencySeconds !== null && <span className="text-muted-foreground">{item.latencySeconds} s</span>}
                  <span className="text-muted-foreground">HTTP {item.code}</span>
                  {item.usd !== null && <span>{usd(item.usd, 4)}</span>}
                  <span className="ml-auto font-mono text-muted-foreground">{item.requestId.slice(0, 12)}…</span>
                </div>
                {item.likely && <p className="text-muted-foreground">Likely: {item.likely}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {section.otherCalls.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Free calls by the platform&apos;s key: {section.otherCalls.map((call) => `${call.path} (${call.count})`).join(", ")}.
        </p>
      )}

      {!creditFigures && section.otherKeys.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-medium text-muted-foreground">
            Other keys in this {section.provider === "elevenlabs" ? "workspace" : "project"} · whole account {usd(section.accountUsd)} this month
          </h4>
          <ul className="mt-1.5 space-y-1 text-sm tabular-nums">
            {section.otherKeys.map((key) => (
              <li key={key.name} className="flex justify-between gap-3">
                <span className="truncate">{key.name}</span>
                <span className="text-muted-foreground">
                  {usd(key.usd)} · {count(key.requests)} requests
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type BoardRow = { user: string; sessions: number; minutes: number; costUsd: number };

/** The month's whiteboard sessions by learner, as Didactra reported them. */
async function whiteboardMonth(month?: string | null): Promise<BoardRow[]> {
  const { start, end } = monthRange(month);
  const rows = await prisma.boardSession.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: start, lt: end } },
    _count: { _all: true },
    _sum: { minutes: true, costUsd: true },
  });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((row) => row.userId) } }, select: { id: true, name: true, email: true } });
  const name = (id: string) => {
    const user = users.find((entry) => entry.id === id);
    return user?.name || user?.email || id;
  };
  return rows
    .map((row) => ({ user: name(row.userId), sessions: row._count._all, minutes: row._sum.minutes ?? 0, costUsd: row._sum.costUsd ?? 0 }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function Whiteboard({ rows }: { rows: BoardRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing this month.</p>;
  const total = rows.reduce((sum, row) => ({ sessions: sum.sessions + row.sessions, minutes: sum.minutes + row.minutes, costUsd: sum.costUsd + row.costUsd }), { sessions: 0, minutes: 0, costUsd: 0 });
  return (
    <table className="w-full min-w-[30rem] text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1.5 pr-3 font-medium">Learner</th>
          <th className="py-1.5 pr-3 text-right font-medium">Sessions</th>
          <th className="py-1.5 pr-3 text-right font-medium">Time</th>
          <th className="py-1.5 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.user} className="border-t border-border">
            <td className="py-1.5 pr-3">{row.user}</td>
            <td className="py-1.5 pr-3 text-right">{count(row.sessions)}</td>
            <td className="py-1.5 pr-3 text-right">{minutes(row.minutes * 60)}</td>
            <td className="py-1.5 text-right">{usd(row.costUsd)}</td>
          </tr>
        ))}
        <tr className="border-t border-border font-medium">
          <td className="py-1.5 pr-3">All</td>
          <td className="py-1.5 pr-3 text-right">{count(total.sessions)}</td>
          <td className="py-1.5 pr-3 text-right">{minutes(total.minutes * 60)}</td>
          <td className="py-1.5 text-right">{usd(total.costUsd)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold tracking-tight">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}

function Table({ rows }: { rows: SpendRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing this month.</p>;
  const top = Math.max(...rows.map((row) => row.billedUsd), 0.000001);
  return (
    <table className="w-full min-w-[34rem] text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="pb-1.5 font-medium">Item</th>
          <th className="pb-1.5 text-right font-medium">Calls</th>
          <th className="pb-1.5 text-right font-medium">Characters</th>
          <th className="pb-1.5 text-right font-medium">Credits</th>
          <th className="pb-1.5 text-right font-medium">Audio</th>
          <th className="pb-1.5 text-right font-medium">Estimated</th>
          <th className="pb-1.5 text-right font-medium">Billed</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="max-w-[18rem] py-1.5 pr-3">
              <span className="block truncate">{row.label}</span>
              <span className="mt-1 block h-1 rounded-full bg-foreground/60" style={{ width: `${Math.max(2, (row.billedUsd / top) * 100)}%` }} aria-hidden="true" />
            </td>
            <td className="py-1.5 text-right">
              {count(row.calls)}
              {row.failedCalls ? <span className="text-destructive"> · {row.failedCalls} failed</span> : null}
            </td>
            <td className="py-1.5 text-right">{row.characters ? count(row.characters) : "–"}</td>
            <td className="py-1.5 text-right">{row.credits ? count(row.credits) : "–"}</td>
            <td className="py-1.5 text-right">{row.audioSeconds ? minutes(row.audioSeconds) : "–"}</td>
            <td className="py-1.5 text-right text-muted-foreground">{usd(row.estimatedUsd)}</td>
            <td className="py-1.5 text-right font-medium">{usd(row.billedUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Days({ report }: { report: SpendReport }) {
  if (!report.byDay.length) return <p className="text-sm text-muted-foreground">Nothing this month.</p>;
  const top = Math.max(...report.byDay.map((day) => day.elevenlabsBilledUsd + day.deepgramBilledUsd), 0.000001);
  return (
    <div className="space-y-1.5">
      <p className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-foreground/75" aria-hidden="true" /> ElevenLabs
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-sky-500/70" aria-hidden="true" /> Deepgram
        </span>
      </p>
      {report.byDay.map((day) => (
        <div key={day.day} className="grid grid-cols-[5.5rem_1fr_6rem_8rem] items-center gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground">{day.day.slice(5)}</span>
          <span className="flex h-3 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
            <span className="h-full bg-foreground/75" style={{ width: `${(day.elevenlabsBilledUsd / top) * 100}%` }} />
            <span className="h-full bg-sky-500/70" style={{ width: `${(day.deepgramBilledUsd / top) * 100}%` }} />
          </span>
          <span className="text-right">{usd(day.elevenlabsBilledUsd + day.deepgramBilledUsd)}</span>
          <span className="text-right text-muted-foreground">{day.elevenlabsCredits ? credits(day.elevenlabsCredits) : ""}</span>
        </div>
      ))}
    </div>
  );
}

function Calls({ report }: { report: SpendReport }) {
  const latest = [...report.charges].reverse().slice(0, 40);
  if (!latest.length) return <p className="text-sm text-muted-foreground">No call this month.</p>;
  return (
    <table className="w-full min-w-[52rem] text-xs tabular-nums">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pb-1.5 font-medium">When</th>
          <th className="pb-1.5 font-medium">Workload</th>
          <th className="pb-1.5 font-medium">For</th>
          <th className="pb-1.5 font-medium">Voice / model</th>
          <th className="pb-1.5 text-right font-medium">Characters</th>
          <th className="pb-1.5 text-right font-medium">Credits</th>
          <th className="pb-1.5 text-right font-medium">Billed</th>
          <th className="pb-1.5 font-medium">In the provider&apos;s log</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {latest.map((row, index) => (
          <tr key={`${row.at}-${index}`} className={cn(row.status !== "ok" && "text-destructive")}>
            <td className="py-1.5 pr-2 whitespace-nowrap">{when(row.at)}</td>
            <td className="py-1.5 pr-2">
              {row.workloadLabel} · {NAME[row.provider]}
              {row.status !== "ok" ? " (failed)" : ""}
            </td>
            <td className="max-w-[16rem] truncate py-1.5 pr-2">{row.lessonTitle ? `${row.lessonCode ?? ""} ${row.lessonTitle}` : (row.userName ?? "–")}</td>
            <td className="py-1.5 pr-2">{row.voiceLabel ?? row.model ?? "–"}</td>
            <td className="py-1.5 pr-2 text-right">{row.characters ? count(row.characters) : "–"}</td>
            <td className="py-1.5 pr-2 text-right">
              {row.credits ? count(row.credits) : "–"}
              {row.revoiced && <span className="text-amber-700 dark:text-amber-300"> · voiced again</span>}
            </td>
            <td className="py-1.5 pr-2 text-right">{usd(row.billedUsd, 4)}</td>
            <td className="py-1.5">{row.matched === null ? (row.backfilled ? "before per-call logging" : "–") : row.matched ? "Yes" : "Not yet"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ElevenLabsCredits({ data }: { data: ElevenCredits }) {
  const plan = data.plan && "used" in data.plan ? data.plan : null;
  const keyNames = data.keys.map((key) => key.name);
  const color = (name: string) => KEY_COLORS[Math.max(0, keyNames.indexOf(name)) % KEY_COLORS.length];
  const topHour = Math.max(...data.byHour.map((hour) => hour.total), 1);
  const topKey = Math.max(...data.keys.map((key) => key.credits), 1);
  const peakKeys = data.peak ? Object.entries(data.peak.byKey).sort((a, b) => b[1] - a[1]) : [];
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-lg font-semibold tracking-tight">ElevenLabs credits</h3>
      <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
        What the plan counts. ElevenLabs&apos; own figures for every key of the workspace, by hour; the platform&apos;s calls each with the credits their response
        said they cost.
      </p>

      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {plan ? (
          <Figure
            label={`Plan${plan.tier ? ` (${plan.tier})` : ""}, this period`}
            value={`${count(plan.used)} / ${count(plan.limit)}`}
            hint={`${Math.round((plan.used / Math.max(plan.limit, 1)) * 100)}% used${plan.resetsAt ? ` · resets ${when(plan.resetsAt)}` : ""}`}
            tone={plan.used > plan.limit * 0.8 ? "attention" : "ok"}
          />
        ) : (
          <Figure
            label="Plan, this period"
            value="–"
            hint={
              data.plan && "unavailable" in data.plan && data.plan.unavailable === "missing-permission"
                ? "Give the platform's key the User: read permission (ElevenLabs → API keys) to show the plan's counter here."
                : "The plan's counter couldn't be read."
            }
          />
        )}
        <Figure label="The platform's key, this month" value={credits(data.billed)} hint={data.byModel.map((model) => `${modelName(model.model)} ${count(model.credits)}`).join(" · ") || "Nothing yet"} />
        <Figure label="Every key, this month" value={credits(data.account)} hint={`${data.keys.length} key${data.keys.length === 1 ? "" : "s"} used, the website counted as one`} />
        <Figure
          label="Voiced again"
          value={credits(data.revoiced.credits)}
          hint={
            data.revoiced.pieces
              ? `${count(data.revoiced.pieces)} lesson pieces paid for twice: their voicing was cut off and started over`
              : "No lesson piece was voiced twice"
          }
          tone={data.revoiced.credits > 0 ? "attention" : "ok"}
        />
      </dl>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold">By key, this month</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">A key you don&apos;t expect to be in use, spending credits, is how a leak shows.</p>
          <table className="mt-2 w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 font-medium">Key</th>
                <th className="pb-1 text-right font-medium">Credits</th>
                <th className="pb-1 text-right font-medium">Requests</th>
                <th className="pb-1 text-right font-medium">Last used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.keys.map((key) => (
                <tr key={key.name}>
                  <td className="max-w-[16rem] py-1.5 pr-3">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("size-2.5 shrink-0 rounded-sm", color(key.name))} aria-hidden="true" />
                      <span className="truncate">{key.name}</span>
                      {key.platform && <span className="shrink-0 rounded border border-border px-1 text-[0.65rem] text-muted-foreground">the platform</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{key.models.map(modelName).join(", ")}</span>
                    <span className={cn("mt-1 block h-1 rounded-full", color(key.name))} style={{ width: `${Math.max(2, (key.credits / topKey) * 100)}%` }} aria-hidden="true" />
                  </td>
                  <td className="py-1.5 text-right font-medium">{count(key.credits)}</td>
                  <td className="py-1.5 text-right">{count(key.requests)}</td>
                  <td className="py-1.5 text-right text-xs whitespace-nowrap text-muted-foreground">{key.lastUsed ? when(key.lastUsed) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            ElevenLabs&apos; log says which key made a request, not from where: no IP address or user agent. Every place that has a key looks the same, so give each
            its own (the platform, the practice worker, the learning service, a PC) to tell them apart here.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold">The last 48 hours, by hour (UTC)</h4>
          {data.peak && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Busiest hour this month: {when(data.peak.hour)}, {credits(data.peak.credits)}
              {peakKeys.length ? ` (${peakKeys.map(([name, value]) => `${name} ${count(value)}`).join(", ")})` : ""}.
            </p>
          )}
          <div className="mt-3 flex h-36 items-end gap-px" role="img" aria-label="Credits by hour over the last 48 hours, by key">
            {data.byHour.map((hour) => (
              <Tip
                key={hour.hour}
                content={
                  hour.total
                    ? `${when(hour.hour)}: ${Object.entries(hour.byKey)
                        .sort((a, b) => b[1] - a[1])
                        .map(([name, value]) => `${name} ${count(value)}`)
                        .join(", ")}`
                    : `${when(hour.hour)}: nothing`
                }
              >
                <span className="flex h-full min-w-0 flex-1 flex-col-reverse rounded-sm bg-muted/40">
                  {Object.entries(hour.byKey)
                    .sort((a, b) => keyNames.indexOf(a[0]) - keyNames.indexOf(b[0]))
                    .map(([name, value]) => (
                      <span key={name} className={cn("w-full", color(name))} style={{ height: `${(value / topHour) * 100}%` }} />
                    ))}
                </span>
              </Tip>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[0.65rem] text-muted-foreground tabular-nums">
            <span>{data.byHour[0] ? when(data.byHour[0].hour) : ""}</span>
            <span>{data.byHour.at(-1) ? when(data.byHour.at(-1)!.hour) : ""}</span>
          </div>

          {data.revoiced.lessons.length > 0 && (
            <div className="mt-5">
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Lessons voiced again</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A voicing that&apos;s cut off (the worker stopped, a credit limit) starts again from its first piece, and the pieces already voiced are paid twice.
              </p>
              <ul className="mt-2 space-y-1 text-sm tabular-nums">
                {data.revoiced.lessons.slice(0, 12).map((lesson) => (
                  <li key={lesson.label} className="flex justify-between gap-3">
                    <span className="truncate">{lesson.label}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {count(lesson.credits)} credits · {lesson.pieces} pieces
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
