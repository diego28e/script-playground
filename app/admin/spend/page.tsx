import { AlertTriangle, CheckCircle2, CircleOff } from "lucide-react";
import { buildSpendReport, type ProviderSection, type SpendReport, type SpendRow } from "@/lib/spend/report";
import { SpendMonth } from "@/components/admin/spend-month";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";

// Admin → Spend (docs/voice-spend.md): the month's voice spend, ElevenLabs and Deepgram, from the platform's own ledger
// of every billable call, checked against what each provider reports for the platform's key.

const usd = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "–" : value > 0 && value < 0.01 && digits <= 2 ? "< US$0.01" : `US$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const count = (value: number) => value.toLocaleString("en-US");
const minutes = (seconds: number) => (seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";
const NAME = { elevenlabs: "ElevenLabs", deepgram: "Deepgram" } as const;

export default async function SpendPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const report = await buildSpendReport((await searchParams).month);
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
        <Figure label="ElevenLabs" value={usd(report.providers.elevenlabs.billed.usd)} hint={`${count(report.providers.elevenlabs.billed.characters ?? 0)} characters, ${count(report.providers.elevenlabs.billed.requests)} requests`} />
        <Figure label="Deepgram" value={usd(report.providers.deepgram.billed.usd)} hint={`${count(report.providers.deepgram.billed.requests)} requests`} />
        <Figure
          label="Unaccounted"
          value={usd(report.totals.unaccountedUsd)}
          hint={
            report.totals.unaccountedRequests
              ? `${count(report.totals.unaccountedRequests)} calls the platform didn't log`
              : report.totals.unaccountedUsd > 0
                ? "Characters billed beyond those logged"
                : "Nothing the platform didn't log"
          }
          tone={report.totals.unaccountedRequests || report.totals.unaccountedUsd > 0.5 ? "attention" : "ok"}
        />
      </dl>

      <div className="grid gap-5 xl:grid-cols-2">
        <Provider section={report.providers.elevenlabs} />
        <Provider section={report.providers.deepgram} />
      </div>

      <Section title="By workload" note="What each kind of work cost. Billed: ElevenLabs shared out at the month's billed rate; Deepgram from its own log, by request or tag.">
        <Table rows={report.byWorkload.map((row) => ({ ...row, label: `${row.label} · ${NAME[row.provider]}` }))} />
      </Section>

      <Section title="By day" note="Billed by each provider, by day (UTC).">
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
    eleven.unaccountedCharacters
      ? `ElevenLabs: ${count(eleven.unaccountedCharacters)} more characters billed than the platform logged (${usd(eleven.unaccounted.usd)}), on days of per-call logging.`
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
          If you didn&apos;t make them yourself (a local test with the production key counts), treat the key as leaked: rotate it in the provider&apos;s dashboard,
          then in Amplify and on the lab server. The calls are listed below and in the exports.
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

function Provider({ section }: { section: ProviderSection }) {
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
        {section.billedPer1000 !== null && <>Billed rate this month: {usd(section.billedPer1000, 3)} per 1,000 characters. </>}
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
              <li key={item.requestId} className="flex flex-wrap gap-x-3 px-3 py-1.5 tabular-nums">
                <span>{when(item.at)}</span>
                <span className="font-mono">{item.path}</span>
                <span className="text-muted-foreground">HTTP {item.code}</span>
                {item.usd !== null && <span>{usd(item.usd, 4)}</span>}
                <span className="ml-auto font-mono text-muted-foreground">{item.requestId.slice(0, 12)}…</span>
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

      {section.otherKeys.length > 0 && (
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
        <div key={day.day} className="grid grid-cols-[5.5rem_1fr_6rem] items-center gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground">{day.day.slice(5)}</span>
          <span className="flex h-3 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
            <span className="h-full bg-foreground/75" style={{ width: `${(day.elevenlabsBilledUsd / top) * 100}%` }} />
            <span className="h-full bg-sky-500/70" style={{ width: `${(day.deepgramBilledUsd / top) * 100}%` }} />
          </span>
          <span className="text-right">{usd(day.elevenlabsBilledUsd + day.deepgramBilledUsd)}</span>
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
            <td className="py-1.5 pr-2 text-right">{usd(row.billedUsd, 4)}</td>
            <td className="py-1.5">{row.matched === null ? (row.backfilled ? "before per-call logging" : "–") : row.matched ? "Yes" : "Not yet"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
