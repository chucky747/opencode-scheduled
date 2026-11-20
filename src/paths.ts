import os from "node:os"
import path from "node:path"

const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

function lookup(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: string,
): string | undefined {
  const direct = env[name]
  if (direct !== undefined) return direct
  if (platform !== "win32") return undefined
  const lower = name.toLowerCase()
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === lower) return env[key]
  }
  return undefined
}

function substitute(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
): string {
  return value.replace(VARIABLE, (match, windows: string, braced: string, plain: string) => {
    const name = windows ?? braced ?? plain
    const found = lookup(env, name, platform)
    return found === undefined ? match : found
  })
}

function toPortable(value: string): string {
  const forward = value.replace(/\\/g, "/")
  if (forward === "/" || /^[A-Za-z]:\/$/.test(forward)) return forward
  return forward.replace(/\/+$/, "")
}

/**
 * Expands a portable directory option into an absolute path with forward slashes.
 *
 * - A leading `~`, `~/`, or `~\` becomes `home`.
 * - `%NAME%`, `$NAME`, and `${NAME}` become the matching environment value.
 *   Lookups are case-insensitive on Windows; unknown variables stay as written.
 * - The result is resolved against the current working directory and normalized
 *   to forward slashes with no trailing separator.
 *
 * The parameters are injectable so callers and tests never depend on the host.
 */
export function expandPath(
  value: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = os.homedir(),
  platform: string = process.platform,
): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const homed =
    trimmed === "~"
      ? home
      : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
        ? home + trimmed.slice(1)
        : trimmed
  return toPortable(path.resolve(substitute(homed, env, platform)))
}
