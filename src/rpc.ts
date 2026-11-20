import { Rpc } from "@opencode/plugin/rpc"

const pathObject = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
  additionalProperties: false,
} as const

/**
 * The path helpers the window half calls on the server half. The server owns
 * `os.homedir()` and `process.env`; the renderer has neither.
 */
export const ScheduledRpc = Rpc.define({
  id: "opencode-scheduled.paths",
  methods: {
    expandPath: {
      input: pathObject,
      output: pathObject,
    },
  },
  events: {},
})

export type ExpandPathInput = { path: string }
export type ExpandPathOutput = { path: string }
