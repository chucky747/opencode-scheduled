import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Command, Panel, Plugin, Slot, Store, TitlebarItem } from "@opencode/plugin/gui"
import { Schema } from "effect"
import type { AutomationInfo } from "@opencode/client/promise"
import { ScheduledRpc } from "./rpc"

type DialogHandle = { close(): void }

type Outcome = NonNullable<AutomationInfo["lastOutcome"]>
type Row = AutomationInfo & {
  server: string
  serverLabel: string
  key: string
  multiServer: boolean
}

type HistoryEntry = { run: number; at: number; outcome: string; output?: string }
type StoredState = { seen: Record<string, number>; history: Record<string, HistoryEntry[]> }

type Filter = "all" | "active" | "paused" | "done"
type FormMode = "new" | "current" | "other" | "child"
type ScheduleMode = "once" | "every" | "cron"
type TaskModelOption = { value: string; label: string; id: string; providerID: string; variant?: string }

let scheduledDirectory = ""

function normalizeDirectory(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "")
}

function setScheduledDirectory(value: string) {
  scheduledDirectory = normalizeDirectory(value.trim())
}

const absoluteDirectory = /^(?:[A-Za-z]:[\\/]|[\\/])/
let directoryExpansionWarned = false

// The renderer has no `os.homedir()`, so portable values such as `~/Scheduled`
// or `%USERPROFILE%\Scheduled` are expanded by the plugin's server half.
function configureScheduledDirectory(ctx: any, value: string) {
  const raw = value.trim()
  setScheduledDirectory(raw)
  if (!raw || (absoluteDirectory.test(raw) && !/[~%$]/.test(raw))) return
  void ctx.client
    .rpc(ScheduledRpc)
    .expandPath({ path: raw })
    .then((result: unknown) => {
      if (ctx.signal?.aborted) return
      const expanded = (result as { path?: unknown } | undefined)?.path
      if (typeof expanded === "string" && expanded) setScheduledDirectory(expanded)
    })
    .catch((error: unknown) => {
      if (directoryExpansionWarned) return
      directoryExpansionWarned = true
      console.warn("[scheduled] could not expand the directory option; using it as written", error)
    })
}

function getScheduledDirectory() {
  return scheduledDirectory
}

function isScheduledDirectory(directory: string) {
  return (
    !!scheduledDirectory &&
    normalizeDirectory(directory).toLowerCase() === scheduledDirectory.toLowerCase()
  )
}

const definition = Plugin.define({
  stores: {
    state: Store.global(Schema.Struct({ seen: Schema.String, history: Schema.String }), {
      seen: "{}",
      history: "{}",
    }),
  },
})

const text = "var(--v2-text-text-base, #e8e8e8)"
const muted = "var(--v2-text-text-muted, #a0a0a0)"
const faint = "var(--v2-text-text-faint, #7a7a7a)"
const borderMuted = "var(--v2-border-border-muted, #333)"
const border = "var(--v2-border-border-base, #3a3a3a)"
const focus = "var(--v2-border-border-focus, #4c8dff)"
const hover = "var(--v2-overlay-simple-overlay-hover, rgba(255,255,255,0.06))"
const panel = "var(--v2-background-bg-layer-01, #222)"
const panel2 = "var(--v2-background-bg-layer-02, #2a2a2a)"
const base = "var(--v2-background-bg-base, #181818)"
const success = "var(--v2-state-fg-success, #6fcf97)"
const warning = "var(--v2-state-fg-warning, #f2c94c)"
const danger = "var(--v2-state-fg-danger, #eb5757)"

const styleSheet = `
.sched-row { transition: background-color 90ms ease-out; }
.sched-row:hover:not([data-selected="true"]) { background-color: ${hover}; }
.sched-row:focus-visible { outline: 2px solid ${focus}; outline-offset: -2px; }
.sched-tab:hover:not([data-active="true"]) { color: ${text}; }
.sched-tab:focus-visible { outline: 2px solid ${focus}; outline-offset: -2px; border-radius: 4px; }
.sched-input:focus, .sched-input:focus-visible { outline: none; box-shadow: 0 0 0 1px ${focus}; }
.sched-code { border-radius: var(--radius-md, 6px); overflow: auto; }
.sched-code > * { margin: 0 !important; }
.sched-copy { min-width: 150px; }
.sched-search { width: 100%; }
`

function Styles() {
  return <style>{styleSheet}</style>
}

const inputStyle = {
  width: "100%",
  "box-sizing": "border-box",
  background: panel,
  color: text,
  border: `1px solid ${border}`,
  "border-radius": "var(--radius-md, 6px)",
  padding: "6px 8px",
  "font-size": "13px",
  "font-weight": 440,
  "line-height": "20px",
  "min-height": "30px",
  outline: "none",
} as const

function readState(ctx: any): StoredState {
  try {
    const value = ctx.stores.state.value as { seen?: string; history?: string }
    const seen = JSON.parse(value.seen || "{}")
    const history = JSON.parse(value.history || "{}")
    return {
      seen: seen && typeof seen === "object" ? seen : {},
      history: history && typeof history === "object" ? history : {},
    }
  } catch {
    return { seen: {}, history: {} }
  }
}

function writeState(ctx: any, next: StoredState) {
  ctx.stores.state.update((draft: { seen: string; history: string }) => {
    draft.seen = JSON.stringify(next.seen)
    draft.history = JSON.stringify(next.history)
  })
}

function relative(ms?: number) {
  if (!ms) return "—"
  const delta = ms - Date.now()
  const abs = Math.abs(delta)
  const unit = abs < 60_000 ? "s" : abs < 3_600_000 ? "m" : abs < 86_400_000 ? "h" : "d"
  const value =
    unit === "s"
      ? Math.round(abs / 1_000)
      : unit === "m"
        ? Math.round(abs / 60_000)
        : unit === "h"
          ? Math.round(abs / 3_600_000)
          : Math.round(abs / 86_400_000)
  const rounded = Math.max(1, value)
  return delta >= 0 ? `in ${rounded}${unit}` : `${rounded}${unit} ago`
}

function deriveName(prompt: string) {
  const line = prompt
    .split(/\r?\n/)
    .map((item) => item.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean)
  if (!line) return ""
  const clean = line.replace(/\s+/g, " ").replace(/[.。]+$/, "")
  return clean.length > 64 ? `${clean.slice(0, 63).trimEnd()}…` : clean
}

function dateTime(ms?: number) {
  if (!ms) return "—"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms))
}

function outcomeLabel(outcome?: string) {
  if (!outcome) return "—"
  return outcome.charAt(0).toUpperCase() + outcome.slice(1)
}

function statusLabel(row: Row) {
  if (row.status === "paused" && row.lastOutcome === "failed") return "Paused after failure"
  if (row.status === "done" && row.lastOutcome === "expired") return "Expired"
  return row.status.charAt(0).toUpperCase() + row.status.slice(1)
}

function statusColor(row: Row) {
  if (row.status === "active") return success
  if (row.status === "paused") return row.lastOutcome === "failed" ? danger : warning
  return faint
}

function cadence(row: Row) {
  const trigger = row.trigger
  if (trigger.type === "at") return `Once · ${dateTime(new Date(trigger.at).getTime())}`
  if (trigger.type === "every") return `Every ${trigger.every}`
  if (trigger.type === "cron") {
    const known: Record<string, string> = {
      "0 9 * * *": "Daily at 09:00",
      "0 9 * * 1-5": "Weekdays at 09:00",
      "0 9 * * 1": "Mondays at 09:00",
      "0 * * * *": "Hourly",
    }
    return known[trigger.cron] ?? `Cron ${trigger.cron}`
  }
  return `On ${trigger.server}/${trigger.event}`
}

function chatTitle(ctx: any, server: string, id?: string) {
  if (!id) return "this chat"
  const ref = ctx.servers.get(server)
  const info = ref?.data?.session?.get?.(id)
  return info?.title || id
}

function targetSessionID(row: Row) {
  if (row.action.type !== "prompt") return row.sessionID
  if (row.action.to?.session) return row.action.to.session
  if (row.action.to?.subagent) {
    const match = row.lastOutput?.match(/ses_[A-Za-z0-9]+/)
    return match?.[0]
  }
  return row.sessionID
}

function destination(ctx: any, row: Row) {
  if (row.action.type !== "prompt") return "Code action"
  if (row.action.to?.subagent) return `New child each run (${row.action.to.subagent})`
  const target = row.action.to?.session ?? row.sessionID
  if (target && target === row.sessionID) {
    if (isScheduledDirectory(row.directory)) return `Scheduled project · ${chatTitle(ctx, row.server, target)}`
    return `This chat · ${chatTitle(ctx, row.server, target)}`
  }
  return `Chat · ${chatTitle(ctx, row.server, target)}`
}

function listDestination(ctx: any, row: Row) {
  const label = destination(ctx, row)
  const prefix = "Scheduled project · "
  if (isScheduledDirectory(row.directory) && label.startsWith(prefix)) {
    const chat = label.slice(prefix.length)
    return chat === row.name ? "Scheduled project" : chat
  }
  return label
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function createMonitor(ctx: any) {
  const [rows, setRows] = createSignal<Row[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | undefined>()
  const [unread, setUnread] = createSignal(0)
  const [running, setRunning] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  let runTimer: ReturnType<typeof setInterval> | undefined
  let inflight = false

  const load = async () => {
    if (inflight) return
    inflight = true
    try {
      const servers = ctx.servers
        .list()
        .map((id: string) => ctx.servers.get(id))
        .filter((server: any) => server?.connected)

      if (servers.length === 0) {
        setError("No connected OpenCode server.")
        setLoading(false)
        return
      }

      const settled = await Promise.allSettled(
        servers.map(async (server: any) => ({
          server,
          list: (await server.client.experimental.automation.list()) as AutomationInfo[],
        })),
      )

      const next: Row[] = []
      const failures: string[] = []
      for (const result of settled) {
        if (result.status === "rejected") {
          failures.push(errorMessage(result.reason))
          continue
        }
        const { server, list } = result.value
        for (const row of list) {
          next.push({
            ...row,
            server: server.id,
            serverLabel: server.name || server.id,
            key: `${server.id}\0${row.id}`,
            multiServer: servers.length > 1,
          })
        }
      }

      next.sort((a, b) => {
        const rank = { active: 0, paused: 1, done: 2 } as Record<string, number>
        return (
          (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
          (a.nextDueAt ?? Number.MAX_SAFE_INTEGER) - (b.nextDueAt ?? Number.MAX_SAFE_INTEGER) ||
          b.time.updated - a.time.updated
        )
      })

      const state = readState(ctx)
      const history = { ...state.history }
      let changed = false
      const newRuns: Array<{ row: Row; entry: HistoryEntry }> = []

      for (const row of next) {
        const previous = state.seen[row.id]
        if (previous === undefined) {
          state.seen[row.id] = row.lastRunAt ?? 0
          changed = true
        }
        if (row.lastRunAt && row.runCount > 0) {
          const entry: HistoryEntry = {
            run: row.runCount,
            at: row.lastRunAt,
            outcome: row.lastOutcome ?? "fired",
            output: row.lastOutput,
          }
          const list = history[row.id] ?? []
          if (!list.some((item) => item.run === entry.run)) {
            history[row.id] = [entry, ...list].slice(0, 20)
            changed = true
            if (previous !== undefined) newRuns.push({ row, entry })
          }
        }
      }

      if (changed) writeState(ctx, { seen: state.seen, history })

      setRows(next)
      setLoading(false)
      setError(failures.length && next.length === 0 ? failures[0] : undefined)
      setUnread(
        next.filter((row) => row.lastRunAt && row.lastRunAt > (state.seen[row.id] ?? 0)).length,
      )
      refreshRunning()

      for (const { row, entry } of newRuns) {
        const target = targetSessionID(row)
        void ctx.attention?.notify?.({
          title: row.name,
          message: `${outcomeLabel(entry.outcome)} · ${relative(entry.at)}`,
          variant: row.lastOutcome === "failed" ? "error" : "default",
          session: target ? { server: row.server, id: target } : undefined,
          id: `${row.id}:${entry.run}`,
        })
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      inflight = false
      setLoading(false)
    }
  }

  const markSeen = (keys?: string[]) => {
    const state = readState(ctx)
    let changed = false
    for (const row of rows()) {
      if (keys && !keys.includes(row.key)) continue
      const value = row.lastRunAt ?? 0
      if ((state.seen[row.id] ?? 0) < value) {
        state.seen[row.id] = value
        changed = true
      }
    }
    if (changed) {
      writeState(ctx, { seen: state.seen, history: state.history })
      setUnread(rows().filter((row) => row.lastRunAt && row.lastRunAt > (state.seen[row.id] ?? 0)).length)
    }
  }

  const sessionInfo = (row: Row) => {
    const target = targetSessionID(row)
    if (!target) return undefined
    return ctx.servers.get(row.server)?.data?.session?.get?.(target)
  }

  const isRunning = (row: Row) => {
    const info = sessionInfo(row)
    if (!info || info.time?.busy === undefined) return false
    return !(info.time.idle !== undefined && info.time.idle >= info.time.busy)
  }

  const runningRows = () => rows().filter(isRunning)
  const dueRows = () =>
    rows().filter(
      (row) => row.status === "active" && row.nextDueAt !== undefined && row.nextDueAt <= now(),
    )

  const activity = () => runningRows().length > 0 || dueRows().length > 0

  const runningLabel = () => {
    const active = runningRows()
    if (active.length === 1) return `${active[0].name} is running`
    if (active.length > 1) return `${active.length} scheduled tasks are running`
    const due = dueRows()
    if (due.length === 1) return `${due[0].name} is due`
    if (due.length > 1) return `${due.length} scheduled tasks are due`
    return ""
  }

  const refreshRunning = () => {
    setNow(Date.now())
    setRunning(runningRows().length > 0)
  }

  const history = (id: string) => readState(ctx).history[id] ?? []
  const seenAt = (id: string) => readState(ctx).seen[id] ?? 0

  onMount(() => {
    void load()
    timer = setInterval(() => void load(), 10_000)
    runTimer = setInterval(refreshRunning, 1_000)
  })
  onCleanup(() => {
    if (timer) clearInterval(timer)
    if (runTimer) clearInterval(runTimer)
  })

  return { rows, loading, error, unread, running, runningRows, dueRows, activity, runningLabel, refresh: load, markSeen, history, seenAt }
}

type Monitor = ReturnType<typeof createMonitor>

function Dot(props: { color: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: `${props.size ?? 8}px`,
        height: `${props.size ?? 8}px`,
        "border-radius": "50%",
        background: props.color,
        "flex-shrink": 0,
      }}
    />
  )
}

function FilterButton(props: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      class="sched-tab"
      data-active={props.active}
      aria-pressed={props.active}
      onClick={props.onClick}
      style={{
        height: "100%",
        padding: "6px",
        border: "none",
        "border-bottom": `1px solid ${props.active ? faint : "transparent"}`,
        background: "transparent",
        color: props.active ? text : muted,
        "font-size": "13px",
        "font-weight": 440,
        "letter-spacing": "-0.04px",
        "font-variant-numeric": "tabular-nums",
        cursor: "default",
        display: "inline-flex",
        "align-items": "center",
        gap: "6px",
      }}
    >
      <span>{props.label}</span>
      <span style={{ color: faint, "font-size": "11px", "font-weight": 440 }}>{props.count}</span>
    </button>
  )
}

function RowButton(props: { ctx: any; row: Row; selected: boolean; unread: boolean; onClick: () => void }) {
  const subtitle = () => {
    const parts = [cadence(props.row), listDestination(props.ctx, props.row)]
    if (props.row.multiServer) parts.unshift(props.row.serverLabel)
    return parts.join(" · ")
  }
  return (
    <button
      type="button"
      class="sched-row"
      data-selected={props.selected}
      aria-pressed={props.selected}
      onClick={props.onClick}
      style={{
        width: "100%",
        "text-align": "left",
        border: "none",
        background: props.selected ? panel2 : "transparent",
        "border-radius": "var(--radius-sm, 4px)",
        padding: "8px 10px",
        cursor: "default",
        display: "flex",
        "flex-direction": "column",
        gap: "3px",
      }}
    >
      <span style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%" }}>
        <Dot color={statusColor(props.row)} size={6} />
        <span style={{ color: text, "font-size": "13px", "font-weight": 530, "letter-spacing": "-0.04px", flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          {props.row.name}
        </span>
        <Show when={props.unread}>
          <Dot color={success} size={6} />
        </Show>
        <span style={{ color: faint, "font-size": "11px", "font-weight": 440, "flex-shrink": 0 }}>{statusLabel(props.row)}</span>
      </span>
      <span style={{ color: muted, "font-size": "11px", "font-weight": 440, "padding-left": "14px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
        {subtitle()}
      </span>
      <Show when={props.row.status === "active" && props.row.nextDueAt}>
        <span style={{ color: faint, "font-size": "11px", "font-weight": 440, "padding-left": "14px" }}>
          Next {relative(props.row.nextDueAt)}
        </span>
      </Show>
    </button>
  )
}

function Section(props: { title: string; children: any; wide?: boolean; meta?: boolean }) {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: props.meta ? "3px" : "7px", "min-width": 0, "grid-column": props.wide ? "1 / -1" : undefined }}>
      <div
        style={{
          color: props.meta ? muted : text,
          "font-size": props.meta ? "11px" : "13px",
          "font-weight": props.meta ? 440 : 530,
          "letter-spacing": props.meta ? "0.05px" : "-0.04px",
          "line-height": props.meta ? "1.2" : "16px",
        }}
      >
        {props.title}
      </div>
      <div style={{ color: text, "font-size": "13px", "font-weight": 440, "line-height": "20px", "overflow-wrap": "anywhere" }}>{props.children}</div>
    </div>
  )
}

type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }

function toChatEntries(messages: any[]): ChatEntry[] {
  const entries: ChatEntry[] = []
  for (const message of messages) {
    if (message?.type === "user" && typeof message.text === "string" && message.text.trim()) {
      entries.push({ kind: "user", text: message.text.trim() })
      continue
    }
    if (message?.type === "assistant") {
      const content = Array.isArray(message.content) ? message.content : []
      const text = content
        .filter((part: any) => part?.type === "text" && typeof part.text === "string")
        .map((part: any) => part.text)
        .join("\n\n")
        .trim()
      if (text) entries.push({ kind: "assistant", text })
    }
  }
  return entries
}

function SessionChat(props: { ctx: any; messages: any[]; loading: boolean; running: boolean; error?: string }) {
  const entries = createMemo(() => toChatEntries(props.messages))
  let box: HTMLDivElement | undefined

  createEffect(() => {
    props.messages
    props.running
    if (!box) return
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 48
    if (nearBottom) box.scrollTop = box.scrollHeight
  })

  return (
    <div
      ref={(element) => {
        box = element
      }}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "14px",
        "min-height": "80px",
        "max-height": "420px",
        "overflow-y": "auto",
        padding: "2px",
        "font-size": "var(--font-size-base, 14px)",
        "line-height": "var(--line-height-large, 1.5)",
      }}
    >
      <Show when={props.error}>
        <div style={{ color: danger, "font-size": "var(--font-size-small, 13px)" }}>{props.error}</div>
      </Show>
      <Show when={props.loading && entries().length === 0}>
        <div style={{ display: "flex", "justify-content": "center", padding: "16px" }}>
          <props.ctx.ui.Loader size="normal" />
        </div>
      </Show>
      <Show when={!props.loading && !props.error && entries().length === 0}>
        <div style={{ color: faint, "font-size": "var(--font-size-small, 13px)" }}>No messages yet.</div>
      </Show>
      <For each={entries()}>
        {(entry) => (
          <Show
            when={entry.kind === "user"}
            fallback={
              <div style={{ "align-self": "stretch", "min-width": 0 }}>
                <props.ctx.ui.Markdown text={entry.text} />
              </div>
            }
          >
            <div
              style={{
                "align-self": "flex-end",
                "max-width": "85%",
                background: panel2,
                border: `0.5px solid ${border}`,
                "border-radius": "var(--radius-lg, 8px)",
                padding: "8px 11px",
                color: text,
                "font-size": "13px",
                "font-weight": 440,
                "line-height": "20px",
                "white-space": "pre-wrap",
                "overflow-wrap": "anywhere",
              }}
            >
              {entry.text}
            </div>
          </Show>
        )}
      </For>
      <Show when={props.running && (entries().length === 0 || entries()[entries().length - 1]?.kind === "user")}>
        <div
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "7px",
            color: faint,
            "font-size": "var(--font-size-small, 13px)",
          }}
        >
          <props.ctx.ui.Loader size="small" />
          Working…
        </div>
      </Show>
    </div>
  )
}

function Detail(props: {
  ctx: any
  monitor: Monitor
  row: Row
  dialog?: DialogHandle
  compact?: boolean
  onBack?: () => void
  onEdit: () => void
  onDuplicate: () => void
}) {
  const [busy, setBusy] = createSignal(false)
  const [runRequestedAt, setRunRequestedAt] = createSignal(0)
  const [chatLoading, setChatLoading] = createSignal(true)
  const [chatError, setChatError] = createSignal<string | undefined>()
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (copyTimer) clearTimeout(copyTimer)
  })
  const chatMessages = () => {
    const sessionID = target()
    const server = props.ctx.servers.get(props.row.server)
    if (!sessionID || !server) return []
    try {
      return server.data?.session?.message?.list?.(sessionID) ?? []
    } catch {
      return []
    }
  }
  const history = () => props.monitor.history(props.row.id).slice(0, 8)
  const target = () => targetSessionID(props.row)

  const modelLabel = () => {
    const sessionID = target()
    if (!sessionID) return "—"
    const model = props.ctx.servers.get(props.row.server)?.data?.session?.get?.(sessionID)?.model
    if (!model) return "—"
    return `${model.providerID}/${model.id}${model.variant ? ` · ${model.variant}` : ""}`
  }

  const sessionBusy = () => {
    const sessionID = target()
    if (!sessionID) return false
    const info = props.ctx.servers.get(props.row.server)?.data?.session?.get?.(sessionID)
    if (!info || info.time?.busy === undefined) return false
    return !(info.time.idle !== undefined && info.time.idle >= info.time.busy)
  }

  const running = () => sessionBusy() || runRequestedAt() > 0

  const run = async (action: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    try {
      await action()
      await props.monitor.refresh()
    } catch (error) {
      props.ctx.toast.show({ variant: "error", title: "Scheduled task failed", description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const copyPrompt = async () => {
    if (props.row.action.type !== "prompt") return
    try {
      await props.ctx.system.copy(props.row.action.prompt)
      setCopied(true)
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => setCopied(false), 2_000)
    } catch (error) {
      props.ctx.toast.show({
        variant: "error",
        title: "Could not copy the prompt",
        description: errorMessage(error),
      })
    }
  }

  const toggle = () =>
    run(async () => {
      const server = props.ctx.servers.get(props.row.server)
      if (!server) throw new Error("Server is no longer connected")
      if (props.row.status === "paused") {
        await server.client.experimental.automation.resume({ automationID: props.row.id })
      } else {
        await server.client.experimental.automation.pause({ automationID: props.row.id })
      }
    })

  const remove = async () => {
    const sessionID = target()
    const shared = !!sessionID && props.monitor.rows().some(
      (row) =>
        row.key !== props.row.key &&
        row.server === props.row.server &&
        targetSessionID(row) === sessionID,
    )
    const ok = await props.ctx.dialogs.confirm({
      title: "Delete scheduled task?",
      description: sessionID
        ? shared
          ? `“${props.row.name}” will stop and be removed. Its chat stays because another task uses it.`
          : `“${props.row.name}” will stop and be removed, together with its chat and messages.`
        : `“${props.row.name}” will stop and be removed.`,
      confirm: "Delete",
      danger: true,
    })
    if (!ok) return
    await run(async () => {
      const server = props.ctx.servers.get(props.row.server)
      if (!server) throw new Error("Server is no longer connected")
      await server.client.experimental.automation.delete({ automationID: props.row.id })
      if (sessionID && !shared) {
        const tab = props.ctx.tabs
          .list()
          .find((item: any) => item.session?.id === sessionID && item.session?.server?.id === props.row.server)
        if (tab) props.ctx.tabs.close(tab.key)
        try {
          await server.client.session.remove({ sessionID })
        } catch (error) {
          if (!/not found|404/i.test(errorMessage(error))) throw error
        }
      }
      props.ctx.toast.show({
        variant: "success",
        title: "Scheduled task deleted",
        description: sessionID
          ? shared
            ? "The task was removed. Its chat is still used by another task."
            : "The task and its chat were removed."
          : "The task was removed.",
      })
    })
  }

  const startRun = () => {
    if (props.row.action.type !== "prompt") return
    if (busy() || running()) return
    const sessionID = target()
    if (!sessionID) {
      props.ctx.toast.show({
        variant: "error",
        title: "No chat to run in",
        description: "This task has not created its chat yet.",
      })
      return
    }
    const server = props.ctx.servers.get(props.row.server)
    if (!server) {
      props.ctx.toast.show({ variant: "error", title: "Server is no longer connected", description: props.row.name })
      return
    }
    const text = props.row.action.prompt
    setRunRequestedAt(Date.now())
    setTimeout(() => setRunRequestedAt(0), 5_000)
    void run(async () => {
      await server.client.session.prompt({ sessionID, text })
      props.ctx.toast.show({ variant: "success", title: "Task started", description: props.row.name })
    })
  }

  createEffect(() => {
    const sessionID = target()
    const server = props.ctx.servers.get(props.row.server)
    if (!sessionID || !server) {
      setChatLoading(false)
      return
    }
    setChatLoading(true)
    setChatError(undefined)
    void server.data.session.message
      .sync(sessionID)
      .catch((error: unknown) => setChatError(errorMessage(error)))
      .finally(() => setChatLoading(false))
  })

  const openChat = () => {
    const id = target()
    if (!id) {
      props.ctx.toast.show({ variant: "error", title: "No chat to open", description: "This run has not created a chat yet." })
      return
    }
    props.dialog?.close()
    props.ctx.tabs.open({ server: props.row.server, id }, { focus: true })
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Show when={props.onBack}>
        <div>
          <props.ctx.ui.Button size="small" variant="ghost-muted" icon="arrow-left" onClick={props.onBack}>
            Back
          </props.ctx.ui.Button>
        </div>
      </Show>
      <div
        style={{
          display: "flex",
          "align-items": "flex-start",
          gap: "12px",
          "flex-wrap": props.compact ? "wrap" : "nowrap",
        }}
      >
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Dot color={statusColor(props.row)} size={6} />
            <h2 style={{ margin: 0, color: text, "font-size": "15px", "font-weight": 640, "line-height": "20px", "letter-spacing": "-0.04px", overflow: "hidden", "text-overflow": "ellipsis" }}>
              {props.row.name}
            </h2>
            <span
              style={{
                color: statusColor(props.row),
                "font-size": "11px",
                "font-weight": 530,
                "flex-shrink": 0,
              }}
            >
              {statusLabel(props.row)}
            </span>
          </div>
          <div style={{ color: muted, "font-size": "12px", "font-weight": 440, "margin-top": "3px" }}>
            {cadence(props.row)} · {props.row.tz}
            <Show when={props.row.multiServer}> · {props.row.serverLabel}</Show>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: "7px",
            "flex-wrap": "wrap",
            "justify-content": props.compact ? "flex-start" : "flex-end",
            width: props.compact ? "100%" : undefined,
          }}
        >
          <props.ctx.ui.Button size="small" onClick={openChat}>
            Open chat
          </props.ctx.ui.Button>
          <Show when={props.row.status !== "done"}>
            <props.ctx.ui.Button size="small" disabled={busy()} onClick={() => void toggle()}>
              {props.row.status === "paused" ? "Resume" : "Pause"}
            </props.ctx.ui.Button>
          </Show>
          <props.ctx.ui.Button size="small" variant="danger" disabled={busy()} onClick={() => void remove()}>
            Delete
          </props.ctx.ui.Button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          "grid-template-columns": "1fr 1fr",
          gap: "12px 18px",
          background: panel,
          "box-shadow": `inset 0 0 0 0.5px ${borderMuted}`,
          "border-radius": "var(--radius-lg, 8px)",
          padding: "12px 14px",
        }}
      >
        <Section meta title="Next run">{props.row.nextDueAt ? `${dateTime(props.row.nextDueAt)} · ${relative(props.row.nextDueAt)}` : "—"}</Section>
        <Section meta title="Last run">
          {props.row.lastRunAt ? `${dateTime(props.row.lastRunAt)} · ${relative(props.row.lastRunAt)}` : "—"}
          <Show when={props.row.lastOutcome}>
            <span style={{ color: props.row.lastOutcome === "failed" ? danger : muted }}> · {outcomeLabel(props.row.lastOutcome)}</span>
          </Show>
        </Section>
        <Section meta title="Runs">{props.row.runCount}</Section>
        <Section meta title="Created">{dateTime(props.row.time.created)}</Section>
        <Section meta wide title="Destination">{destination(props.ctx, props.row)}</Section>
        <Section meta wide title="Model">{modelLabel()}</Section>
        <Section meta wide title="Folder">{props.row.directory}</Section>
      </div>

      <Show when={props.row.action.type === "prompt"}>
        <Section title="Prompt">
          <div style={{ display: "flex", "flex-direction": "column", gap: "9px" }}>
            <div class="sched-code" style={{ "max-height": "240px" }}>
              <props.ctx.ui.Code content={props.row.action.type === "prompt" ? props.row.action.prompt : ""} language="text" />
            </div>
            <div style={{ display: "flex", gap: "7px", "flex-wrap": "wrap", "align-items": "center" }}>
              <Show when={target()}>
                <props.ctx.ui.Button
                  size="small"
                  variant="contrast"
                  disabled={busy() || running()}
                  onClick={() => void startRun()}
                >
                  <Show when={running()}>
                    <props.ctx.ui.Loader size="small" />
                  </Show>
                  {running() ? "Running" : "Run task"}
                </props.ctx.ui.Button>
              </Show>
              <props.ctx.ui.Button
                size="small"
                variant="ghost"
                class="sched-copy"
                icon={copied() ? "check" : "copy"}
                onClick={() => void copyPrompt()}
              >
                {copied() ? "Copied" : "Copy prompt"}
              </props.ctx.ui.Button>
              <props.ctx.ui.Button size="small" variant="ghost" onClick={props.onDuplicate}>
                Duplicate
              </props.ctx.ui.Button>
              <Show when={props.row.trigger.type !== "event"}>
                <props.ctx.ui.Button size="small" variant="ghost" onClick={props.onEdit}>
                  Edit
                </props.ctx.ui.Button>
              </Show>
            </div>
          </div>
        </Section>
      </Show>

      <Show when={target()}>
        <Section title="Chat">
          <SessionChat ctx={props.ctx} messages={chatMessages()} loading={chatLoading()} running={running()} error={chatError()} />
        </Section>
      </Show>

      <Show when={props.row.lastOutput}>
        <Section title="Last output">
          <div class="sched-code" style={{ "max-height": "180px" }}>
            <props.ctx.ui.Code content={props.row.lastOutput ?? ""} language="text" />
          </div>
        </Section>
      </Show>

      <Show when={history().length > 0}>
        <Section title="Recent runs seen in this app">
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <For each={history()}>
              {(entry) => (
                <div style={{ display: "flex", gap: "8px", "font-size": "12px", color: muted }}>
                  <span style={{ color: faint, width: "96px", "flex-shrink": 0 }}>{dateTime(entry.at)}</span>
                  <span style={{ color: entry.outcome === "failed" ? danger : text, width: "72px", "flex-shrink": 0 }}>
                    {outcomeLabel(entry.outcome)}
                  </span>
                  <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{entry.output || "—"}</span>
                </div>
              )}
            </For>
          </div>
        </Section>
      </Show>
    </div>
  )
}

function toLocalInput(ms: number) {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseEvery(value: string) {
  const match = value.trim().match(/^(\d+)\s+(second|minute|hour|day)s?$/i)
  if (!match) return { n: 1, unit: "hours" as const }
  const n = Number(match[1])
  const raw = match[2].toLowerCase()
  const unit = raw.startsWith("second") ? "minutes" : raw.startsWith("minute") ? "minutes" : raw.startsWith("hour") ? "hours" : "days"
  return { n, unit }
}

function Field(props: { label: string; hint?: string; children: any }) {
  return (
    <label style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <span style={{ color: text, "font-size": "13px", "font-weight": 530, "letter-spacing": "-0.04px", "line-height": "16px" }}>{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span style={{ color: muted, "font-size": "11px", "font-weight": 440, "line-height": "16px" }}>{props.hint}</span>
      </Show>
    </label>
  )
}

function ScheduledForm(props: {
  ctx: any
  monitor: Monitor
  row?: Row
  clone?: Row
  initialPrompt?: string
  targetSession?: any
  embedded?: boolean
  onDone: (created: AutomationInfo, server: string) => void
  onCancel: () => void
  onOpenExisting?: (row: Row) => void
}) {
  const seed = () => props.row ?? props.clone

  const source = props.row ?? props.clone

  const original = () => {
    if (!source) return undefined
    const target = source.action.type === "prompt" ? source.action.to?.session : undefined
    const id = target ?? source.sessionID
    if (!id) return undefined
    const server = props.ctx.servers.get(source.server)
    if (!server) return undefined
    return {
      id,
      server,
      directory: source.directory,
      pending: false,
      key: `${source.server}\n${id}`,
    }
  }

  const current = () => (source ? original() : props.targetSession ?? props.ctx.sessions.current())

  const template = () => props.targetSession ?? props.ctx.sessions.current()
  const templateInfo = () => {
    const session = template()
    return session?.server?.data?.session?.get?.(session.id)
  }
  const templateModel = templateInfo()?.model

  const scheduledServer = () => {
    const servers = props.ctx.servers
      .list()
      .map((id: string) => props.ctx.servers.get(id))
      .filter((server: any) => server?.connected)
    return servers.find((server: any) => server.local) ?? servers[0]
  }

  const [name, setName] = createSignal(
    props.clone ? `${props.clone.name} copy` : props.row?.name ?? "",
  )
  const [nameEdited, setNameEdited] = createSignal(!!source)
  const [prompt, setPrompt] = createSignal(
    source?.action.type === "prompt" ? source.action.prompt : props.initialPrompt ?? "",
  )

  createEffect(() => {
    const value = prompt()
    if (source || nameEdited()) return
    setName(deriveName(value))
  })
  const [targetMode, setTargetMode] = createSignal<FormMode>(
    !source
      ? "new"
      : source.action.type === "prompt" && source.action.to?.subagent
        ? "child"
        : source.action.type === "prompt" && source.action.to?.session && source.action.to.session !== source.sessionID
          ? "other"
          : "current",
  )
  const [otherID, setOtherID] = createSignal(
    source?.action.type === "prompt" && source.action.to?.session ? source.action.to.session! : "",
  )
  const initialTrigger = source?.trigger
  const initialEvery = initialTrigger?.type === "every" ? parseEvery(initialTrigger.every) : { n: 1, unit: "hours" as const }
  const [scheduleMode, setScheduleMode] = createSignal<ScheduleMode>(
    initialTrigger?.type === "at" ? "once" : initialTrigger?.type === "every" ? "every" : "cron",
  )
  const [onceAt, setOnceAt] = createSignal(
    initialTrigger?.type === "at" && !/^in\s/i.test(initialTrigger.at)
      ? (() => {
          const parsed = new Date(initialTrigger.at)
          return Number.isNaN(parsed.getTime()) ? toLocalInput(Date.now() + 10 * 60_000) : toLocalInput(parsed.getTime())
        })()
      : toLocalInput(Date.now() + 10 * 60_000),
  )
  const [everyN, setEveryN] = createSignal(String(initialEvery.n))
  const [everyUnit, setEveryUnit] = createSignal(initialEvery.unit)
  const [cron, setCron] = createSignal(initialTrigger?.type === "cron" ? initialTrigger.cron : "0 9 * * 1-5")
  const [tz, setTz] = createSignal(seed()?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [expires, setExpires] = createSignal(seed()?.expires ? toLocalInput(seed()!.expires!) : "")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()
  const [duplicate, setDuplicate] = createSignal<Row | undefined>()
  let submitting = false
  const [models, setModels] = createSignal<TaskModelOption[]>([])
  const [modelKey, setModelKey] = createSignal(
    templateModel ? `${templateModel.providerID}/${templateModel.id}` : "",
  )

  async function loadModels() {
    const server = scheduledServer()
    if (!server) return
    const directory = getScheduledDirectory()
    try {
      const result = await server.client.model.list({
        ...(directory ? { location: { directory } } : {}),
        types: ["chat"],
      })
      const options: TaskModelOption[] = result.data
        .filter((model: any) => model.enabled !== false)
        .map((model: any) => {
          const id = model.modelID || model.id
          return {
            value: `${model.providerID}/${id}`,
            label: `${model.name} · ${model.providerID}`,
            id,
            providerID: model.providerID,
          }
        })
      if (templateModel) {
        const value = `${templateModel.providerID}/${templateModel.id}`
        if (!options.some((option) => option.value === value)) {
          options.unshift({
            value,
            label: `${templateModel.providerID}/${templateModel.id}`,
            id: templateModel.id,
            providerID: templateModel.providerID,
            variant: templateModel.variant,
          })
        }
      }
      const unique = Array.from(new Map(options.map((option) => [option.value, option])).values())
      setModels(unique)
      if (!unique.some((option) => option.value === modelKey())) {
        setModelKey(unique[0]?.value ?? "")
      }
    } catch {
      // The task still inherits the creating chat's model when the catalog is unavailable.
    }
  }

  onMount(() => {
    if (targetMode() === "new") void loadModels()
  })

  const others = createMemo(() => {
    const active = current()
    const projectID = active?.server?.data?.session?.get?.(active.id)?.projectID
    return props.ctx.sessions
      .list()
      .filter((session: any) => session.id !== active?.id && !session.pending)
      .filter((session: any) => {
        if (!projectID) return true
        return session.server?.data?.session?.get?.(session.id)?.projectID === projectID
      })
  })

  const otherOptions = createMemo(() =>
    others().map((session: any) => ({
      value: session.id,
      label: chatTitle(props.ctx, session.server.id, session.id),
    })),
  )

  const buildTrigger = () => {
    if (scheduleMode() === "once") {
      const value = onceAt().trim()
      if (!value) throw new Error("Choose a date and time.")
      if (Number.isNaN(new Date(value).getTime())) throw new Error("Choose a valid date and time.")
      return { type: "at" as const, at: value, tz: tz().trim() || undefined }
    }
    if (scheduleMode() === "every") {
      const n = Number(everyN())
      if (!Number.isFinite(n) || n < 1) throw new Error("Interval must be at least 1.")
      if (everyUnit() === "minutes" && n < 1) throw new Error("The minimum interval is one minute.")
      return { type: "every" as const, every: `${Math.floor(n)} ${everyUnit()}`, tz: tz().trim() || undefined }
    }
    const expression = cron().trim()
    if (!expression) throw new Error("Enter a cron expression.")
    return { type: "cron" as const, cron: expression, tz: tz().trim() || undefined }
  }

  const expiry = () => {
    const value = expires().trim()
    if (!value) return undefined
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw new Error("Choose a valid expiry date.")
    return parsed.toISOString()
  }

  const submit = async () => {
    if (submitting || busy()) return
    setError(undefined)
    setDuplicate(undefined)
    const wantsNewSession = targetMode() === "new" && !seed()
    const active = wantsNewSession ? undefined : current()
    if (!wantsNewSession && !active) {
      setError("Open a chat first, or choose a new session in the Scheduled project.")
      return
    }
    const desiredName = name().trim()
    if (!desiredName) {
      setError("Give the task a name.")
      return
    }
    if (!prompt().trim()) {
      setError("Enter the prompt to send on each run.")
      return
    }
    if (targetMode() === "other" && !otherID()) {
      setError("Choose the chat to receive the prompt.")
      return
    }

    const selfKey = props.row ? `${props.row.server}\0${props.row.id}` : undefined
    const targetServerID = wantsNewSession ? scheduledServer()?.id : active?.server?.id
    const siblings = props.monitor.rows().filter((row) => row.key !== selfKey && row.server === targetServerID)
    const nameTaken = siblings.find(
      (row) => row.name.trim().toLowerCase() === desiredName.toLowerCase(),
    )
    if (nameTaken) {
      setDuplicate(nameTaken)
      setError(
        `A task named “${nameTaken.name}” already exists in this project. Choose a different name, or open the existing task.`,
      )
      return
    }

    const effectiveTarget =
      wantsNewSession || targetMode() === "child"
        ? undefined
        : targetMode() === "other"
          ? otherID()
          : active?.id
    if (effectiveTarget && !props.clone) {
      const normalized = prompt().trim()
      const promptTaken = siblings.find(
        (row) =>
          row.action.type === "prompt" &&
          row.action.prompt.trim() === normalized &&
          targetSessionID(row) === effectiveTarget,
      )
      if (promptTaken) {
        setDuplicate(promptTaken)
        setError(
          `This prompt is already scheduled in “${promptTaken.name}” for the same chat. Edit that task, or change the prompt.`,
        )
        return
      }
    }

    submitting = true
    setBusy(true)
    let createdSession: string | undefined
    let createdServer: any
    let createdAutomation = false
    try {
      const trigger = buildTrigger()
      const expiresAt = expiry()
      const action: any = { type: "prompt", prompt: prompt().trim() }
      let server: any
      let sessionID: string

      if (wantsNewSession) {
        server = scheduledServer()
        if (!server) throw new Error("The local OpenCode server is not connected.")
        const directory = getScheduledDirectory()
        if (!directory) {
          throw new Error("Set the Scheduled project directory in the plugin options.")
        }
        const inheritedModel = templateInfo()?.model
        const selected = models().find((option) => option.value === modelKey())
        const chosenModel = selected
          ? selected.value === (inheritedModel ? `${inheritedModel.providerID}/${inheritedModel.id}` : "")
            ? inheritedModel
            : { id: selected.id, providerID: selected.providerID }
          : inheritedModel
        const session = await server.client.session.create({
          title: desiredName,
          location: { directory },
          ...(chosenModel ? { model: chosenModel } : {}),
        })
        createdSession = session.id
        sessionID = session.id
        action.to = { session: session.id }

        try {
          const projects = await server.client.project.list()
          const project = projects.find((item: any) => item.id === session.projectID)
          if (project && project.name !== "Scheduled") {
            await server.client.project.update({ projectID: session.projectID, name: "Scheduled" })
          }
        } catch {
          // The project can already exist or be renamed later; the task still works.
        }
      } else {
        if (!active) throw new Error("No chat selected.")
        server = active.server
        sessionID = active.id
        if (targetMode() === "other") action.to = { session: otherID() }
        if (targetMode() === "child") action.to = { subagent: "general" }
      }

      const payload: any = {
        sessionID,
        name: desiredName,
        trigger,
        action,
      }
      createdServer = server
      if (expiresAt) payload.expires = expiresAt

      const created = (await server.client.experimental.automation.create(payload)) as AutomationInfo
      createdAutomation = true

      if (props.row) {
        const oldServer = props.ctx.servers.get(props.row.server)
        if (!oldServer) throw new Error("The original server is not connected.")
        try {
          await oldServer.client.experimental.automation.delete({ automationID: props.row.id })
        } catch (cause) {
          const rolledBack = await server.client.experimental.automation
            .delete({ automationID: created.id })
            .then(() => true)
            .catch(() => false)
          createdAutomation = false
          throw new Error(
            rolledBack
              ? `The old task could not be removed, so the replacement was rolled back. ${errorMessage(cause)}`
              : `The old task could not be removed and the replacement could not be rolled back. Delete “${created.name}” manually.`,
          )
        }
      }

      if (props.row?.status === "paused") {
        await server.client.experimental.automation
          .pause({ automationID: created.id })
          .catch(() => undefined)
      }
      await props.monitor.refresh()
      props.ctx.toast.show({
        variant: "success",
        title: props.row ? "Scheduled task updated" : "Scheduled task created",
        description: wantsNewSession ? `${created.name} · new session in Scheduled` : created.name,
      })
      props.onDone(created, server.id)
    } catch (cause) {
      if (createdSession && !createdAutomation) {
        await createdServer?.client.session.remove({ sessionID: createdSession }).catch(() => undefined)
      }
      setError(errorMessage(cause))
    } finally {
      submitting = false
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "13px",
        "max-height": props.embedded ? "none" : "64vh",
        "overflow-y": props.embedded ? "visible" : "auto",
        "padding-right": "4px",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: text, "font-size": "15px", "font-weight": 640, "line-height": "20px", "letter-spacing": "-0.04px" }}>
            {props.row ? "Edit scheduled task" : props.clone ? "Duplicate scheduled task" : "New scheduled task"}
          </div>
          <div style={{ color: muted, "font-size": "12px", "font-weight": 440, "margin-top": "2px" }}>
            {targetMode() === "new"
              ? getScheduledDirectory()
                ? `Tied to: a new session in ${getScheduledDirectory()}`
                : "Tied to: set the Scheduled project directory in the plugin options."
              : current()
                ? `Tied to: ${chatTitle(props.ctx, current().server.id, current().id)}`
                : "Open a chat to schedule work."}
          </div>
        </div>
        <Show when={!props.embedded}>
          <props.ctx.ui.Button size="small" variant="ghost" onClick={props.onCancel}>
            Cancel
          </props.ctx.ui.Button>
        </Show>
      </div>

      <Show when={props.row}>
        <div style={{ display: "flex", "align-items": "flex-start", gap: "8px", color: text, "font-size": "12px", "font-weight": 440, "line-height": "18px", background: panel, border: `0.5px solid ${border}`, "border-radius": "var(--radius-md, 6px)", padding: "8px 10px" }}>
          <span style={{ color: warning, "flex-shrink": 0, "margin-top": "1px" }}>
            <props.ctx.ui.Icon name="circle-exclamation" size="small" />
          </span>
          <span>Editing replaces the task, so its run count restarts. The chat and its messages are untouched.</span>
        </div>
      </Show>

      <Field label="Name">
        <input
          class="sched-input"
          style={inputStyle}
          value={name()}
          onInput={(event) => {
            setNameEdited(true)
            setName(event.currentTarget.value)
            setError(undefined)
            setDuplicate(undefined)
          }}
        />
      </Field>

      <Field label="Prompt" hint="Write it so it still makes sense days from now, without this conversation.">
        <textarea
          class="sched-input"
          style={{ ...inputStyle, "min-height": "110px", resize: "vertical", "font-family": "inherit" }}
          value={prompt()}
          onInput={(event) => {
            setPrompt(event.currentTarget.value)
            setError(undefined)
            setDuplicate(undefined)
          }}
          placeholder="Check the deploy, summarize what changed, and report only if something needs attention."
        />
      </Field>

      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "12px" }}>
        <Field label="Send to">
          <props.ctx.ui.Select
            label="Send to"
            value={targetMode()}
            onChange={(value: string) => setTargetMode(value as FormMode)}
            options={[
              ...(seed() ? [] : [{ value: "new", label: "New session in Scheduled project" }]),
              { value: "current", label: "This chat" },
              { value: "other", label: "Another open chat" },
              { value: "child", label: "New child chat each run" },
            ]}
          />
        </Field>
        <Show when={targetMode() === "new"}>
          <div style={{ color: muted, "font-size": "11px", "font-weight": 440, "line-height": "16px", "grid-column": "1 / -1" }}>
            Each task gets its own chat in the Scheduled project. Its runs appear there, and the dashboard links to it.
          </div>
        </Show>
        <Show when={targetMode() === "other"}>
          <Field label="Chat">
            <props.ctx.ui.Select
              label="Chat"
              value={otherID()}
              placeholder={otherOptions().length ? "Choose a chat" : "No other open chats"}
              onChange={setOtherID}
              options={otherOptions()}
            />
          </Field>
        </Show>
        <Show when={targetMode() === "child"}>
          <Field label="Child agent" hint="Each run starts a fresh child session with this agent.">
            <input class="sched-input" style={{ ...inputStyle, opacity: 0.8 }} value="general" readOnly />
          </Field>
        </Show>
      </div>

      <Show when={targetMode() === "new"}>
        <Field
          label="Model"
          hint={
            models().length > 0
              ? "The new task chat starts on this model."
              : "The new task chat inherits the model from this chat."
          }
        >
          <Show
            when={models().length > 0}
            fallback={
              <input
                class="sched-input" style={{ ...inputStyle, opacity: 0.8 }}
                value={templateModel ? `${templateModel.providerID}/${templateModel.id}` : "Inherited from this chat"}
                readOnly
              />
            }
          >
            <props.ctx.ui.Select
              label="Model"
              value={modelKey()}
              onChange={setModelKey}
              placeholder="Choose a model"
              options={models().map((option) => ({ value: option.value, label: option.label }))}
            />
          </Show>
        </Field>
      </Show>

      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "12px" }}>
        <Field label="Schedule">
          <props.ctx.ui.Select
            label="Schedule"
            value={scheduleMode()}
            onChange={(value: string) => setScheduleMode(value as ScheduleMode)}
            options={[
              { value: "once", label: "Once" },
              { value: "every", label: "Every interval" },
              { value: "cron", label: "Cron / calendar" },
            ]}
          />
        </Field>
        <Field label="Time zone">
          <input class="sched-input" style={inputStyle} value={tz()} onInput={(event) => setTz(event.currentTarget.value)} />
        </Field>
      </div>

      <Show when={scheduleMode() === "once"}>
        <Field label="Run at">
          <input class="sched-input" type="datetime-local" style={inputStyle} value={onceAt()} onInput={(event) => setOnceAt(event.currentTarget.value)} />
        </Field>
      </Show>

      <Show when={scheduleMode() === "every"}>
        <div style={{ display: "grid", "grid-template-columns": "120px 1fr", gap: "12px" }}>
          <Field label="Repeat every">
            <input class="sched-input" style={inputStyle} value={everyN()} onInput={(event) => setEveryN(event.currentTarget.value)} />
          </Field>
          <Field label="Unit">
            <props.ctx.ui.Select
              label="Unit"
              value={everyUnit()}
              onChange={(value: string) => setEveryUnit(value as any)}
              options={[
                { value: "minutes", label: "Minutes" },
                { value: "hours", label: "Hours" },
                { value: "days", label: "Days" },
              ]}
            />
          </Field>
        </div>
      </Show>

      <Show when={scheduleMode() === "cron"}>
        <Field label="Cron expression" hint="Five fields: minute hour day-of-month month day-of-week. Runs at most once a minute.">
          <input class="sched-input" style={inputStyle} value={cron()} onInput={(event) => setCron(event.currentTarget.value)} placeholder="0 9 * * 1-5" />
        </Field>
        <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
          <For each={[
            { label: "Daily 09:00", value: "0 9 * * *" },
            { label: "Weekdays 09:00", value: "0 9 * * 1-5" },
            { label: "Mondays 09:00", value: "0 9 * * 1" },
            { label: "Hourly", value: "0 * * * *" },
          ]}>
            {(preset) => (
              <props.ctx.ui.Button size="small" variant="ghost" onClick={() => setCron(preset.value)}>
                {preset.label}
              </props.ctx.ui.Button>
            )}
          </For>
        </div>
      </Show>

      <Field label="Expires (optional)" hint="Leave empty to keep the task until you delete it.">
        <input class="sched-input" type="datetime-local" style={inputStyle} value={expires()} onInput={(event) => setExpires(event.currentTarget.value)} />
      </Field>

      <Show when={targetMode() === "child"}>
        <div style={{ color: muted, "font-size": "11px", "font-weight": 440, "line-height": "16px" }}>
          Each run creates a child session under this chat. The child does not report back, but the last child is linked from the task.
        </div>
      </Show>

      <Show when={error()}>
        <div style={{ color: danger, "font-size": "12px", "font-weight": 440, "line-height": "18px", background: `color-mix(in srgb, ${danger} 8%, transparent)`, border: `0.5px solid ${danger}`, "border-radius": "var(--radius-md, 6px)", padding: "8px 10px" }}>
          <div>{error()}</div>
          <Show when={duplicate()}>
            {(row) => (
              <div style={{ "margin-top": "6px" }}>
                <props.ctx.ui.Button
                  size="small"
                  variant="ghost"
                  onClick={() => props.onOpenExisting?.(row())}
                  disabled={!props.onOpenExisting}
                >
                  Open “{row().name}”
                </props.ctx.ui.Button>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "padding-top": "2px" }}>
        <props.ctx.ui.Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </props.ctx.ui.Button>
        <props.ctx.ui.Button variant="contrast" busy={busy()} disabled={busy()} onClick={() => void submit()}>
          {props.row ? "Save task" : "Create task"}
        </props.ctx.ui.Button>
      </div>
    </div>
  )
}

function ScheduledPanel(props: {
  ctx: any
  monitor: Monitor
  requested: () => { nonce: number; prompt?: string; session?: any; consumed?: boolean }
  onConsume: () => void
}) {
  const [mode, setMode] = createSignal<"list" | "create">("list")
  const [editing, setEditing] = createSignal<Row | undefined>()
  const [clone, setClone] = createSignal<Row | undefined>()
  const [filter, setFilter] = createSignal<Filter>("all")
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal<string | undefined>()
  const [bootPrompt, setBootPrompt] = createSignal<string | undefined>()
  const [bootSession, setBootSession] = createSignal<any>()
  const [formNonce, setFormNonce] = createSignal(0)

  const counts = createMemo(() => {
    const rows = props.monitor.rows()
    return {
      all: rows.length,
      active: rows.filter((row) => row.status === "active").length,
      paused: rows.filter((row) => row.status === "paused").length,
      done: rows.filter((row) => row.status === "done").length,
    }
  })

  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase()
    return props.monitor.rows().filter((row) => {
      if (filter() !== "all" && row.status !== filter()) return false
      if (!needle) return true
      return [
        row.name,
        row.directory,
        row.serverLabel,
        row.action.type === "prompt" ? row.action.prompt : "",
        row.lastOutput ?? "",
        destination(props.ctx, row),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  })

  const selectedRow = createMemo(() => {
    const key = selected()
    if (!key) return undefined
    return filtered().find((row) => row.key === key)
  })

  const startCreate = (row?: Row, copy?: Row) => {
    setEditing(row)
    setClone(copy)
    setBootPrompt(undefined)
    setBootSession(undefined)
    setFormNonce((value) => value + 1)
    setMode("create")
  }

  const done = (created: AutomationInfo, server: string) => {
    setEditing(undefined)
    setClone(undefined)
    setBootPrompt(undefined)
    setBootSession(undefined)
    setMode("list")
    setFilter("all")
    setQuery("")
    setSelected(`${server}\0${created.id}`)
  }

  const openExisting = (row: Row) => {
    setEditing(undefined)
    setClone(undefined)
    setBootPrompt(undefined)
    setBootSession(undefined)
    setMode("list")
    setFilter("all")
    setQuery("")
    setSelected(row.key)
  }

  onMount(() => {
    props.monitor.markSeen()
    const timer = setInterval(() => props.monitor.markSeen(), 5_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const request = props.requested()
    if (request.nonce === 0 || request.consumed) return
    setEditing(undefined)
    setClone(undefined)
    setBootPrompt(request.prompt)
    setBootSession(request.session)
    setFormNonce((value) => value + 1)
    setMode("create")
    props.onConsume()
  })

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "min-height": 0,
        background: base,
        color: text,
      }}
    >
      <Styles />
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "7px",
          padding: "10px 12px",
          "border-bottom": `1px solid ${border}`,
          "flex-shrink": 0,
        }}
      >
        <Show
          when={props.monitor.activity()}
          fallback={<div style={{ flex: 1 }} />}
        >
          <span
            title={props.monitor.runningLabel()}
            style={{
              display: "inline-flex",
              "align-items": "center",
              gap: "5px",
              color: muted,
              "font-size": "11px",
              "min-width": 0,
              flex: 1,
            }}
          >
            <props.ctx.ui.Loader size="small" />
            <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
              {props.monitor.runningLabel()}
            </span>
          </span>
        </Show>
        <props.ctx.ui.Button size="small" icon="plus" onClick={() => startCreate()}>
          New task
        </props.ctx.ui.Button>
      </div>

      <Show when={props.monitor.error()}>
        <div
          style={{
            color: danger,
            "font-size": "12px",
            "font-weight": 440,
            "line-height": "18px",
            background: `color-mix(in srgb, ${danger} 8%, transparent)`,
            border: `0.5px solid ${danger}`,
            "border-radius": "var(--radius-md, 6px)",
            margin: "8px 10px 0",
            padding: "8px 10px",
          }}
        >
          {props.monitor.error()}
        </div>
      </Show>

      <Show when={mode() === "list"}>
        <Show when={!selectedRow()}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              height: "32px",
              padding: "0 8px",
              "border-bottom": `1px solid ${border}`,
              "flex-shrink": 0,
            }}
          >
            <FilterButton active={filter() === "all"} label="All" count={counts().all} onClick={() => setFilter("all")} />
            <FilterButton active={filter() === "active"} label="Active" count={counts().active} onClick={() => setFilter("active")} />
            <FilterButton active={filter() === "paused"} label="Paused" count={counts().paused} onClick={() => setFilter("paused")} />
            <FilterButton active={filter() === "done"} label="Done" count={counts().done} onClick={() => setFilter("done")} />
          </div>

          <div style={{ padding: "8px 8px", "flex-shrink": 0 }}>
            <props.ctx.ui.TextInput class="sched-search" label="Search" value={query()} onInput={setQuery} placeholder="Search tasks" />
          </div>
        </Show>

        <div style={{ flex: 1, "min-height": 0, "overflow-y": "auto", padding: "0 6px 8px" }}>
          <Show
            when={selectedRow()}
            fallback={
              <Show
                when={props.monitor.loading() && props.monitor.rows().length === 0}
                fallback={
                  <Show
                    when={filtered().length === 0}
                    fallback={
                      <For each={filtered()}>
                        {(row) => (
                          <RowButton
                            ctx={props.ctx}
                            row={row}
                            selected={false}
                            unread={!!row.lastRunAt && row.lastRunAt > props.monitor.seenAt(row.id)}
                            onClick={() => setSelected(row.key)}
                          />
                        )}
                      </For>
                    }
                  >
                    <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "8px", padding: "36px 16px", "text-align": "center" }}>
                      <Show
                        when={props.monitor.rows().length === 0}
                        fallback={
                          <>
                            <div style={{ color: text, "font-size": "13px", "font-weight": 530 }}>Nothing matches this filter</div>
                            <div style={{ color: muted, "font-size": "13px", "font-weight": 440, "line-height": "20px" }}>Try another filter or clear the search.</div>
                          </>
                        }
                      >
                        <div style={{ color: text, "font-size": "13px", "font-weight": 530 }}>No scheduled tasks yet</div>
                        <div style={{ color: muted, "font-size": "13px", "font-weight": 440, "line-height": "20px", "max-width": "300px" }}>
                          Create a prompt that runs on its own schedule in the Scheduled project.
                        </div>
                        <props.ctx.ui.Button size="small" variant="contrast" icon="plus" onClick={() => startCreate()}>
                          New task
                        </props.ctx.ui.Button>
                      </Show>
                    </div>
                  </Show>
                }
              >
                <div style={{ display: "flex", "justify-content": "center", padding: "24px" }}>
                  <props.ctx.ui.Loader size="normal" />
                </div>
              </Show>
            }
          >
            {(row) => (
              <div style={{ padding: "4px 4px 10px" }}>
                <Detail
                  ctx={props.ctx}
                  monitor={props.monitor}
                  row={row()}
                  compact
                  onBack={() => setSelected(undefined)}
                  onEdit={() => startCreate(row())}
                  onDuplicate={() => startCreate(undefined, row())}
                />
              </div>
            )}
          </Show>
        </div>
      </Show>

      <Show when={mode() === "create"}>
        <div style={{ flex: 1, "min-height": 0, "overflow-y": "auto", padding: "10px 12px 12px" }}>
          <Show when={mode() === "create" ? formNonce() : false} keyed={true}>
            {(((nonce: number) => (
              <ScheduledForm
                ctx={props.ctx}
                monitor={props.monitor}
                row={editing()}
                clone={clone()}
                initialPrompt={bootPrompt()}
                targetSession={bootSession()}
                embedded
                onCancel={() => {
                  setEditing(undefined)
                  setClone(undefined)
                  setMode("list")
                }}
                onDone={done}
                onOpenExisting={openExisting}
              />
            )) as any)}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function ScheduledDialog(props: {
  ctx: any
  monitor: Monitor
  dialog: DialogHandle
  initial?: { mode?: "list" | "create"; prompt?: string; session?: any }
}) {
  const [mode, setMode] = createSignal<"list" | "create">(props.initial?.mode === "create" ? "create" : "list")
  const [editing, setEditing] = createSignal<Row | undefined>()
  const [clone, setClone] = createSignal<Row | undefined>()
  const [filter, setFilter] = createSignal<Filter>("all")
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal<string | undefined>()
  const [bootPrompt, setBootPrompt] = createSignal(props.initial?.prompt)
  const [bootSession, setBootSession] = createSignal(props.initial?.session)
  const [formNonce, setFormNonce] = createSignal(props.initial?.mode === "create" ? 1 : 0)

  const counts = createMemo(() => {
    const rows = props.monitor.rows()
    return {
      all: rows.length,
      active: rows.filter((row) => row.status === "active").length,
      paused: rows.filter((row) => row.status === "paused").length,
      done: rows.filter((row) => row.status === "done").length,
    }
  })

  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase()
    return props.monitor.rows().filter((row) => {
      if (filter() !== "all" && row.status !== filter()) return false
      if (!needle) return true
      const haystack = [
        row.name,
        row.directory,
        row.serverLabel,
        row.action.type === "prompt" ? row.action.prompt : "",
        row.lastOutput ?? "",
        destination(props.ctx, row),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  })

  const selectedRow = createMemo(() => {
    const rows = filtered()
    return rows.find((row) => row.key === selected()) ?? rows[0]
  })

  const markVisibleSeen = () => {
    if (mode() === "list") props.monitor.markSeen()
  }

  onMount(() => {
    markVisibleSeen()
    const timer = setInterval(markVisibleSeen, 5_000)
    onCleanup(() => clearInterval(timer))
  })

  const startCreate = (row?: Row, copy?: Row) => {
    setEditing(row)
    setClone(copy)
    setBootPrompt(undefined)
    setBootSession(undefined)
    setFormNonce((value) => value + 1)
    setMode("create")
  }

  const done = (created: AutomationInfo, server: string) => {
    setEditing(undefined)
    setClone(undefined)
    setBootPrompt(undefined)
    setBootSession(undefined)
    setMode("list")
    setFilter("all")
    setQuery("")
    setSelected(`${server}\0${created.id}`)
  }

  const openExisting = (row: Row) => {
    setEditing(undefined)
    setClone(undefined)
    setBootPrompt(undefined)
    setBootSession(undefined)
    setMode("list")
    setFilter("all")
    setQuery("")
    setSelected(row.key)
  }

  const body = (
    <div style={{ display: "flex", "flex-direction": "column", gap: "12px", "min-height": 0 }}>
      <Styles />
      <Show when={props.monitor.error()}>
        <div style={{ color: danger, "font-size": "12px", "font-weight": 440, "line-height": "18px", background: `color-mix(in srgb, ${danger} 8%, transparent)`, border: `0.5px solid ${danger}`, "border-radius": "var(--radius-md, 6px)", padding: "8px 10px" }}>
          {props.monitor.error()}
          <Show when={props.monitor.error()?.toLowerCase().includes("disabled")}>
            <div style={{ color: muted, "margin-top": "5px" }}>
              Add <code>{"experimental.automations: true"}</code> to the OpenCode config, then reload.
            </div>
          </Show>
        </div>
      </Show>

      <Show when={mode() === "list"}>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              height: "32px",
              "border-bottom": `1px solid ${border}`,
            }}
          >
            <FilterButton active={filter() === "all"} label="All" count={counts().all} onClick={() => setFilter("all")} />
            <FilterButton active={filter() === "active"} label="Active" count={counts().active} onClick={() => setFilter("active")} />
            <FilterButton active={filter() === "paused"} label="Paused" count={counts().paused} onClick={() => setFilter("paused")} />
            <FilterButton active={filter() === "done"} label="Done" count={counts().done} onClick={() => setFilter("done")} />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ width: "220px" }}>
            <props.ctx.ui.TextInput label="Search" value={query()} onInput={setQuery} placeholder="Search tasks" />
          </div>
          <props.ctx.ui.Button variant="contrast" icon="plus" onClick={() => startCreate()}>
            New
          </props.ctx.ui.Button>
        </div>

        <div style={{ display: "flex", gap: "14px", "min-height": 0, height: "60vh" }}>
          <div style={{ width: "320px", "flex-shrink": 0, display: "flex", "flex-direction": "column", "min-height": 0, border: `0.5px solid ${border}`, "border-radius": "var(--radius-lg, 8px)", background: base, overflow: "hidden" }}>
            <div style={{ "overflow-y": "auto", flex: 1, padding: "6px" }}>
              <Show when={props.monitor.loading() && props.monitor.rows().length === 0}>
                <div style={{ display: "flex", "justify-content": "center", padding: "24px" }}>
                  <props.ctx.ui.Loader size="normal" />
                </div>
              </Show>
              <Show when={!props.monitor.loading() && filtered().length === 0}>
                <div style={{ color: muted, "font-size": "13px", "font-weight": 440, padding: "18px 10px", "line-height": "20px" }}>
                  {props.monitor.rows().length === 0
                    ? "No scheduled tasks yet. Create one in the Scheduled project."
                    : "Nothing matches this filter."}
                </div>
              </Show>
              <For each={filtered()}>
                {(row) => (
                  <RowButton
                    ctx={props.ctx}
                    row={row}
                    selected={selectedRow()?.key === row.key}
                    unread={!!row.lastRunAt && row.lastRunAt > props.monitor.seenAt(row.id)}
                    onClick={() => setSelected(row.key)}
                  />
                )}
              </For>
            </div>
          </div>

          <div style={{ flex: 1, "min-width": 0, "overflow-y": "auto", border: `0.5px solid ${border}`, "border-radius": "var(--radius-lg, 8px)", background: base, padding: "16px" }}>
            <Show when={selectedRow()} fallback={<div style={{ color: muted, "font-size": "13px", "font-weight": 440 }}>Select a scheduled task.</div>}>
              {(row) => (
                <Detail
                  ctx={props.ctx}
                  monitor={props.monitor}
                  row={row()}
                  dialog={props.dialog}
                  onEdit={() => startCreate(row())}
                  onDuplicate={() => startCreate(undefined, row())}
                />
              )}
            </Show>
          </div>
        </div>
      </Show>

      <Show when={mode() === "create"}>
        <Show when={mode() === "create" ? formNonce() : false} keyed={true}>
          {(((nonce: number) => (
            <ScheduledForm
              ctx={props.ctx}
              monitor={props.monitor}
              row={editing()}
              clone={clone()}
              initialPrompt={bootPrompt()}
              targetSession={bootSession()}
              onCancel={() => {
                setEditing(undefined)
                setClone(undefined)
                setMode("list")
              }}
              onDone={done}
              onOpenExisting={openExisting}
            />
          )) as any)}
        </Show>
      </Show>
    </div>
  )

  return (
    <props.ctx.ui.Dialog
      title="Scheduled"
      description="Chat-tied prompts that run on the OpenCode automations engine."
      size="x-large"
      footer={
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", width: "100%" }}>
          <props.ctx.ui.Button variant="ghost" onClick={props.dialog.close}>
            Close
          </props.ctx.ui.Button>
        </div>
      }
    >
      {body}
    </props.ctx.ui.Dialog>
  )
}

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const configuredDirectory = (ctx.options as any)?.directory
  if (typeof configuredDirectory === "string") configureScheduledDirectory(ctx, configuredDirectory)
  const monitor = createMonitor(ctx)
  let active: DialogHandle | undefined
  const panelKey = `${ctx.id}:main`
  const [createRequest, setCreateRequest] = createSignal<{ nonce: number; prompt?: string; session?: any; consumed?: boolean }>({
    nonce: 0,
    consumed: true,
  })

  const openDialog = (initial?: { mode?: "list" | "create"; prompt?: string; session?: any }) => {
    active?.close()
    active = ctx.dialogs.open((dialog) => (
      <ScheduledDialog
        ctx={ctx}
        monitor={monitor}
        dialog={dialog}
        initial={initial}
      />
    ))
  }

  const open = (initial?: { mode?: "list" | "create"; prompt?: string; session?: any }) => {
    if (initial?.mode === "create") {
      setCreateRequest((current) => ({
        nonce: current.nonce + 1,
        prompt: initial.prompt,
        session: initial.session,
        consumed: false,
      }))
    }
    const session = ctx.sessions.current()
    if (session) {
      ctx.layout.open(panelKey, session, { background: true })
      return
    }
    setCreateRequest((current) => ({ ...current, consumed: true }))
    openDialog(initial)
  }

  const panelTab: any = { id: "main", title: "Scheduled", closable: "compact" }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    width: 560,
    mobile: { title: "Scheduled", order: 45, kind: "menu", icon: "status" },
    list: (input: any) => (input.open.includes("main") ? [panelTab] : []),
    render: () => (
      <ScheduledPanel
        ctx={ctx}
        monitor={monitor}
        requested={createRequest}
        onConsume={() => setCreateRequest((current) => ({ ...current, consumed: true }))}
      />
    ),
  })

  ctx.add(TitlebarItem, (): any => ({
    id: "open",
    label: monitor.running()
      ? "Scheduled is running"
      : monitor.unread() > 0
        ? `Scheduled (${monitor.unread()})`
        : "Scheduled",
    title: "Scheduled tasks",
    icon: "status",
    busy: monitor.running(),
    run: () => open(),
  }))

  ctx.add(Command, (): any => ({
    id: "open",
    title: "Scheduled",
    description: "Open scheduled tasks",
    keywords: "automation schedule cron recurring job",
    group: "Scheduled",
    section: "session",
    bind: "mod+shift+s",
    run: () => open(),
  }))

  ctx.add(Command, (): any => ({
    id: "create",
    title: "Schedule a task…",
    description: "Create a recurring prompt in the Scheduled project",
    keywords: "automation schedule cron recurring",
    group: "Scheduled",
    section: "session",
    slash: { name: "schedule", arguments: true },
    run: (input?: string) => {
      const session = ctx.sessions.current()
      const composerText = ctx.screen.current()?.composer?.text?.()
      open({ mode: "create", prompt: input || composerText || "", session })
    },
  }))

  ctx.add(Slot, {
    at: "session.header",
    order: 20,
    render: () => (
      <ctx.ui.Button
        size="small"
        variant="ghost-muted"
        icon={monitor.running() ? undefined : "status"}
        onClick={() => open()}
      >
        <Show when={monitor.running()}>
          <ctx.ui.Loader size="small" />
        </Show>
        {monitor.unread() > 0 ? `Scheduled (${monitor.unread()})` : "Scheduled"}
      </ctx.ui.Button>
    ),
  })

  ctx.add(Slot, {
    at: "session.location.menu",
    render: (input: any) => (
      <ctx.ui.MenuItem
        label="Schedule a task…"
        icon="status"
        onSelect={() => {
          const composerText = ctx.screen.current()?.composer?.text?.()
          open({ mode: "create", prompt: composerText || "", session: input.session })
        }}
      />
    ),
  })
}

export default Plugin.define({ ...definition, setup })


