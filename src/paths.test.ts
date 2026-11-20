import { describe, expect, test } from "bun:test"
import path from "node:path"
import { expandPath } from "./paths"

const home = path.resolve("/", "home", "tester")
const env = { USERPROFILE: home, HOME: home }

function forward(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, "")
}

const homePortable = forward(home)

describe("expandPath", () => {
  test("expands a bare tilde to the injected home", () => {
    expect(expandPath("~", env, home)).toBe(homePortable)
  })

  test("expands a leading tilde and slash", () => {
    expect(expandPath("~/Scheduled", env, home)).toBe(`${homePortable}/Scheduled`)
  })

  test("expands a leading tilde and backslash and normalizes separators", () => {
    expect(expandPath("~\\Scheduled", env, home)).toBe(`${homePortable}/Scheduled`)
  })

  test("expands Windows-style variables from injected env", () => {
    expect(expandPath("%USERPROFILE%\\Scheduled", env, home, "win32")).toBe(
      `${homePortable}/Scheduled`,
    )
  })

  test("looks up Windows-style variables case-insensitively on win32", () => {
    expect(expandPath("%userprofile%\\Scheduled", env, home, "win32")).toBe(
      `${homePortable}/Scheduled`,
    )
  })

  test("expands $NAME from injected env", () => {
    expect(expandPath("$HOME/Scheduled", env, home)).toBe(`${homePortable}/Scheduled`)
  })

  test("expands ${NAME} from injected env", () => {
    expect(expandPath("${HOME}/Scheduled", env, home)).toBe(`${homePortable}/Scheduled`)
  })

  test("leaves unknown variables as written", () => {
    const result = expandPath("$SCHEDULED_TEST_UNSET/data", {}, home)
    expect(result.endsWith("/$SCHEDULED_TEST_UNSET/data")).toBe(true)
  })

  test("leaves unknown Windows-style variables as written", () => {
    const result = expandPath("%SCHEDULED_TEST_UNSET%\\data", {}, home, "win32")
    expect(result.endsWith("/%SCHEDULED_TEST_UNSET%/data")).toBe(true)
  })

  test("passes absolute paths through unchanged", () => {
    const absolute = path.resolve("/", "srv", "scheduled")
    expect(expandPath(absolute, env, home)).toBe(forward(absolute))
  })

  test("removes trailing separators", () => {
    const absolute = path.resolve("/", "srv", "scheduled")
    expect(expandPath(`${absolute}///`, env, home)).toBe(forward(absolute))
  })

  test("returns empty for an empty or whitespace-only option", () => {
    expect(expandPath("", env, home)).toBe("")
    expect(expandPath("   ", env, home)).toBe("")
  })

  test("never returns backslashes", () => {
    expect(expandPath("~\\Scheduled", env, home).includes("\\")).toBe(false)
  })
})
