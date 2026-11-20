import { Plugin } from "@opencode/plugin"
import { expandPath } from "./paths"
import { ScheduledRpc } from "./rpc"

function readPath(input: unknown): string {
  const value = (input as { path?: unknown } | undefined)?.path
  return typeof value === "string" ? value : ""
}

export default Plugin.define({
  id: "opencode-scheduled",
  async setup(ctx) {
    let dispose: (() => void) | undefined
    try {
      const registration = await ctx.rpc.register(ScheduledRpc, {
        expandPath: async (input) => ({ path: expandPath(readPath(input)) }),
      })
      dispose = () => {
        void registration.dispose()
      }
    } catch (error) {
      console.warn("[scheduled] path expansion unavailable", error)
    }
    return () => {
      dispose?.()
    }
  },
})
