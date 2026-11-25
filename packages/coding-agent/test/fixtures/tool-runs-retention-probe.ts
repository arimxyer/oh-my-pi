/**
 * Retention probe for collapsed tool runs (`tool-runs-retention.test.ts`): presents tool calls on
 * the interactive-mode fixture, clears the transcript, collects, and prints how many of the calls
 * are still alive. Argument: `on` or `off` (`display.collapseToolActivity`).
 */
import { vi } from "bun:test";
import type { ToolCall } from "../../src/ui/transcript/tool-block";
import { contextDisplay, createInteractiveModeContext } from "../helpers/interactive-mode-context";

const CALLS = 20;
const ctx = createInteractiveModeContext();
contextDisplay(ctx).collapseToolActivity.set(process.argv[2] === "on");
const refs: WeakRef<ToolCall>[] = [];

// Presenting lives in its own frame so the calls it makes are not left in this module's register
// slots when the collector scans the stack conservatively.
async function presentAndClear(): Promise<void> {
	for (let i = 0; i < CALLS; i++) {
		const id = `call${i}`;
		const pending = ctx.presentToolCall({ id, name: "bash", args: { command: "true" }, tool: undefined, cwd: "/" });
		pending.updateResult({ content: [{ type: "text", text: `output ${i}` }] }, false, id);
		pending.seal();
		refs.push(new WeakRef(pending.call!));
	}
	ctx.shell.transcript.clear();
	// The fixture's spies record every call's arguments and results: no part of the transcript.
	vi.clearAllMocks();
}

await presentAndClear();
let live = CALLS;
for (let turn = 0; turn < 10 && live > 0; turn++) {
	await Bun.sleep(0);
	Bun.gc(true);
	live = refs.filter(ref => ref.deref() !== undefined).length;
}
process.stdout.write(JSON.stringify({ calls: CALLS, live }));
process.exit(0);
