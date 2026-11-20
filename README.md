# OpenCode Scheduled

A GUI plugin for **OpenCode Desktop 2.3.2** that adds a docked **Scheduled** side
panel for cron, interval, and one-shot tasks. It wraps OpenCode's native
`experimental.automations` engine; the plugin does not run its own scheduler and
does not patch `app.asar`.

## Features

- **Scheduled** entry in the chat header, plus `Ctrl+Shift+S`, `/schedule`, and a
  footer/titlebar item.
- Docked side panel in the session's side region. A dialog is used only as a
  fallback when no session is open (Home or a draft).
- Filters for All / Active / Paused / Done with search.
- Once, interval, and cron triggers with an explicit timezone.
- **One chat per task** by default: each new task gets its own session in the
  configured Scheduled project.
- **Model picker** when creating a task chat, defaulting to the creating chat's
  model.
- **Run task** starts the prompt immediately and shows the host loader while the
  chat is busy.
- **Copy prompt** confirms with a check icon and a **Copied** label. The prompt
  block is the app's own read-only code block, with its copy button.
- Task names are unique within a project. Creating a task with an existing name
  is blocked and offers a shortcut to the existing task; scheduling the same
  prompt in the same chat is blocked too.
- New tasks take a name from the prompt's first line until you edit the name, so
  repeated scheduling of the same prompt cannot silently create identical tasks.
- Pause, resume, duplicate, edit-as-recreate, and delete. Deleting a task also
  removes the chat session it owns, after a confirmation that names the chat.
- Unread badge, recent-run history, last output, and an accurate running/due task
  name in the panel header.
- Theme-native controls: host buttons, selects, text inputs, loaders, code blocks,
  and Markdown, plus `--v2-*` color tokens, so light and dark themes apply.
- A read-only chat preview under the prompt actions, built from the app's session
  message store and host Markdown renderer. **Open chat** opens the full
  interactive chat.

## Requirements

- OpenCode Desktop **2.3.2** (GUI plugin API).
- `experimental.automations: true` in the OpenCode config.
- A local directory for the Scheduled project. The plugin creates sessions there,
  but does not create the directory itself.

## Install

Clone the plugin into the plugins folder used by your OpenCode config:

```powershell
git clone https://github.com/chucky747/opencode-scheduled.git `
  "$env:USERPROFILE\.config\opencode\plugins\scheduled"
```

Register it and enable the automation engine in `opencode.json`:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/scheduled",
      "options": {
        "directory": "~/Scheduled"
      }
    }
  ],
  "experimental": {
    "automations": true
  }
}
```

`options.directory` accepts a portable path. Use `~/Scheduled`, `~\Scheduled`,
`%USERPROFILE%\Scheduled`, or `$HOME/Scheduled`; an absolute path also works. A
leading `~` becomes the server user's home directory, `%NAME%`, `$NAME`, and
`${NAME}` become environment values (case-insensitive on Windows, unknown
variables left as written), and the result is resolved and normalized to forward
slashes. A relative value is resolved from the server's working directory.

The value is expanded by the plugin's server half over plugin RPC, because the
window half has no home directory or environment of its own. Create the folder
and register it as a project in the app (**Settings → Projects → Add project**);
the plugin creates sessions there and names the project **Scheduled**.

Reload OpenCode:

```powershell
& "$env:LOCALAPPDATA\Programs\ai.opencode.desktop\resources\opencode-cli.exe" reload
```

The **Scheduled** entry appears in the chat header. Settings → Extensions →
Plugins should list the plugin as active.

## Usage

1. Open a chat.
2. Click **Scheduled** in the chat header, press `Ctrl+Shift+S`, or run
   `/schedule`.
3. Choose **New task**, enter a name and prompt, pick the target and model, and
   choose a schedule.
4. Manage the task from the panel: **Run task** for an immediate run, **Open
   chat** for the full chat, **Pause/Resume**, **Duplicate**, **Edit**, or
   **Delete**.

**Run task** sends the prompt directly to the task chat. It does not increment
the automation's scheduled run count or last-run fields; those reflect runs by
the automation engine.

## Build

The repository includes `dist/gui-experimental.cjs` so the plugin loads without a
build step. Rebuild after changing `src/gui.tsx`:

```powershell
$env:PATH = "$env:LOCALAPPDATA\Programs\bun;$env:PATH"
bun install
bun run typecheck
bun run build
```

## Limits

- The GUI plugin API has no top-level sidebar registry. Entry points are the chat
  header, the footer/titlebar item, and the command palette; the plugin cannot add
  a row beside **Projects**.
- A "new child each run" task creates a nested child session per run, not a new
  top-level chat.
- The automation schema has no model, reasoning-effort, or worktree field. A new
  task chat is created with the model chosen in the form; later runs use that
  chat's current model.
- There is no update endpoint. Editing creates the replacement first, then removes
  the old job; if the old job cannot be removed, the replacement is rolled back.
  Run count still resets.
- The server exposes only the last run. **Recent runs seen in this app** is a local
  history approximation.
- The GUI plugin API does not expose the session timeline component. The inline
  chat is a read-only preview from the session message store and host Markdown;
  tool cards, the composer, and the rest of the timeline stay in the real chat
  opened by **Open chat**.
- Jobs run only while the OpenCode server is alive. Missed repeating slots are
  skipped; a missed one-shot runs once when the server comes back.
- Unattended runs can stall on tool approval. Use narrow permissions for the
  recipient chat or a dedicated agent when running without supervision.

## License

MIT
