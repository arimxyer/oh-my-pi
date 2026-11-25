/**
 * Collapsed tool activity (`display.collapseToolActivity`): each run of tool cards draws as one
 * summary row; reply text between calls starts a new run; a click on the row shows its cards.
 */
import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import {
	attachTerminal,
	contextDisplay,
	createInteractiveModeContext,
	renderTranscript,
} from "../../helpers/interactive-mode-context";

function bash(ctx: InteractiveModeContext, id: string, output: string, isError = false): void {
	const pending = ctx.presentToolCall({
		id,
		name: "bash",
		args: { command: `echo ${id}` },
		tool: undefined,
		cwd: "/",
	});
	pending.setArgsComplete(id);
	pending.setExecutionStarted(id);
	pending.updateResult({ content: [{ type: "text", text: output }], isError }, false, id);
	pending.seal();
}

function reply(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "fake",
		model: "fake",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	} as AssistantMessage;
}

describe("collapsed tool activity", () => {
	it("draws each run of calls as one summary row, split by reply text, and shows a run on a click", () => {
		const ctx = createInteractiveModeContext();
		contextDisplay(ctx).collapseToolActivity.set(true);
		bash(ctx, "one", "first-output");
		bash(ctx, "two", "second-output");
		ctx.presentAssistant(reply("Between the runs."));
		bash(ctx, "three", "third-output");

		const rows = renderTranscript(ctx);
		const text = rows.join("\n");
		expect(rows.filter(row => row.includes("tool call"))).toEqual([
			expect.stringContaining("▸ 2 tool calls"),
			expect.stringContaining("▸ 1 tool call"),
		]);
		expect(text).toContain("Between the runs.");
		expect(text).not.toContain("first-output");
		expect(text).not.toContain("third-output");

		const term = attachTerminal(ctx, { columns: 120, rows: 60 });
		const row = term.screen().findIndex(line => line.includes("▸ 2 tool calls"));
		term.mouse({ row, col: 2, button: "left", action: "press", mods: [] });
		const shown = term.screen().join("\n");
		expect(shown).toContain("▾ 2 tool calls");
		expect(shown).toContain("first-output");
		expect(shown).toContain("second-output");
		expect(shown).not.toContain("third-output");
		term.dispose();
	});

	it("names how many calls of a run failed, only when one did", () => {
		const ctx = createInteractiveModeContext();
		contextDisplay(ctx).collapseToolActivity.set(true);
		bash(ctx, "one", "ok");
		bash(ctx, "two", "boom", true);
		bash(ctx, "three", "boom", true);
		ctx.presentAssistant(reply("Between the runs."));
		bash(ctx, "four", "ok");

		const runs = renderTranscript(ctx).filter(row => row.includes("tool call"));
		expect(runs).toEqual([expect.stringContaining("2 failed"), expect.not.stringContaining("failed")]);
	});

	it("ends a run's row with its newest call's title and target", () => {
		const ctx = createInteractiveModeContext();
		contextDisplay(ctx).collapseToolActivity.set(true);
		bash(ctx, "first", "ok");
		bash(ctx, "second", "ok");

		const [row] = renderTranscript(ctx, 160).filter(line => line.includes("tool call"));
		expect(row).toMatch(/echo second\s*$/);
		expect(row).not.toContain("echo first");
	});

	it("names the call still running over a newer one that already finished", () => {
		const ctx = createInteractiveModeContext();
		contextDisplay(ctx).collapseToolActivity.set(true);
		const slow = ctx.presentToolCall({
			id: "slow",
			name: "bash",
			args: { command: "echo slow" },
			tool: undefined,
			cwd: "/",
		});
		slow.setArgsComplete("slow");
		slow.setExecutionStarted("slow");
		bash(ctx, "fast", "ok");

		const [row] = renderTranscript(ctx, 160).filter(line => line.includes("tool call"));
		expect(row).toContain("echo slow");
		expect(row).not.toContain("echo fast");
	});

	it("opens every run while ctrl+o expands all, and a click still folds one", () => {
		const ctx = createInteractiveModeContext();
		const display = contextDisplay(ctx);
		display.collapseToolActivity.set(true);
		bash(ctx, "one", "first-output");
		ctx.presentAssistant(reply("Between the runs."));
		bash(ctx, "two", "second-output");
		display.toolOutputExpanded.set(true);
		const text = renderTranscript(ctx).join("\n");
		expect(text).toContain("first-output");
		expect(text).toContain("second-output");
		expect(text).not.toContain("▸");

		const term = attachTerminal(ctx, { columns: 120, rows: 60 });
		const row = term.screen().findIndex(line => line.includes("▾ 1 tool call"));
		term.mouse({ row, col: 2, button: "left", action: "press", mods: [] });
		const shown = term.screen().join("\n");
		expect(shown).not.toContain("first-output");
		expect(shown).toContain("second-output");
		term.dispose();
	});

	it("opens the newest card's run when the newest-card key unfolds it", () => {
		const ctx = createInteractiveModeContext();
		contextDisplay(ctx).collapseToolActivity.set(true);
		bash(ctx, "one", "first-output");
		bash(ctx, "two", Array.from({ length: 30 }, (_, i) => `second ${i}`).join("\n"));
		expect(ctx.toggleNewestToolCard()).toBe(true);
		const text = renderTranscript(ctx).join("\n");
		expect(text).toContain("▾ 2 tool calls");
		expect(text).toContain("second 0");
		expect(text).toContain("second 29");

		// The next press folds the run back into its summary row.
		expect(ctx.toggleNewestToolCard()).toBe(true);
		const folded = renderTranscript(ctx).join("\n");
		expect(folded).toContain("▸ 2 tool calls");
		expect(folded).not.toContain("second 29");
	});

	it("pins an open group's row on top in fullscreen while scrolled into it, and folds it from there", () => {
		const ctx = createInteractiveModeContext();
		contextDisplay(ctx).collapseToolActivity.set(true);
		for (const id of ["one", "two", "three"])
			bash(ctx, id, Array.from({ length: 8 }, (_, i) => `${id} line ${i}`).join("\n"));
		ctx.toggleNewestToolCard();
		const term = attachTerminal(ctx, { columns: 100, rows: 16, fullscreen: true });
		// The window follows the tail: the group's own row is far above, its pinned copy on top.
		expect(term.screen()[0]).toContain("▾ 3 tool calls");
		expect(term.screen().join("\n")).toContain("three line 7");
		term.mouse({ row: 0, col: 2, button: "left", action: "press", mods: [] });
		const folded = term.screen().join("\n");
		expect(folded).toContain("▸ 3 tool calls");
		expect(folded).not.toContain("line");
		term.dispose();
	});

	it("opens every group with the toggle-all key, and folds them all when any is open, also under expand-all", () => {
		const ctx = createInteractiveModeContext();
		const display = contextDisplay(ctx);
		display.collapseToolActivity.set(true);
		bash(ctx, "one", "first-output");
		ctx.presentAssistant(reply("Between the runs."));
		bash(ctx, "two", "second-output");

		// Everything folded: the key opens every group.
		expect(ctx.toggleToolRuns()).toBe("opened");
		let text = renderTranscript(ctx).join("\n");
		expect(text).toContain("first-output");
		expect(text).toContain("second-output");

		// Any open: the key folds them all.
		expect(ctx.toggleToolRuns()).toBe("folded");
		text = renderTranscript(ctx).join("\n");
		expect(text).not.toContain("first-output");
		expect(text).not.toContain("second-output");

		// Expand-all opened them: the key folds them all.
		display.toolOutputExpanded.set(true);
		expect(renderTranscript(ctx).join("\n")).toContain("first-output");
		expect(ctx.toggleToolRuns()).toBe("folded");
		text = renderTranscript(ctx).join("\n");
		expect(text).not.toContain("first-output");
		expect(text).toContain("▸ 1 tool call");
	});
});
