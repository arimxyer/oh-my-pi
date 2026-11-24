/** @jsxImportSource @oh-my-pi/pi-tui */
/**
 * A click on a tool card's first row folds or unfolds that card alone, in the terminal renderer.
 */
import { describe, expect, it } from "bun:test";
import { createTestTerminal } from "@oh-my-pi/pi-tui/testing/terminal";
import "../../../src/ui/styles/tools";
import "../../../src/ui/tools";
import { ToolBlock, ToolCall } from "../../../src/ui/transcript/tool-block";

function finishedCall(id: string, lines: number): ToolCall {
	const call = new ToolCall({ id, name: "ext_tool", args: { q: id } });
	call.setArgsComplete();
	call.setExecutionStarted();
	const text = Array.from({ length: lines }, (_, i) => `${id} line ${i}`).join("\n");
	call.updateResult({ content: [{ type: "text", text }] }, false);
	return call;
}

describe("tool card fold", () => {
	it("unfolds and folds one card on a click on its first row, leaving the others as they are", () => {
		const first = finishedCall("one", 30);
		const second = finishedCall("two", 30);
		const term = createTestTerminal(() => ({ main: [<ToolBlock call={first} />, <ToolBlock call={second} />] }), {
			columns: 60,
			rows: 200,
		});
		try {
			const shown = (id: string) => term.screen().filter(row => row.includes(`${id} line`)).length;
			const folded = shown("one");
			expect(folded).toBeLessThan(30);
			expect(shown("two")).toBe(folded);

			const header = term.screen().findIndex(row => row.trim() !== "");
			const click = () => term.mouse({ row: header, col: 2, button: "left", action: "press", mods: [] });
			click();
			expect(shown("one")).toBe(30);
			expect(shown("two")).toBe(folded);

			click();
			expect(shown("one")).toBe(folded);
		} finally {
			term.dispose();
		}
	});

	it("unfolds a compact-presented card to its full card, and folds it back to the compact line", () => {
		const call = finishedCall("one", 30);
		call.setPresentation("compact");
		const term = createTestTerminal(() => ({ main: [<ToolBlock call={call} />] }), { columns: 60, rows: 200 });
		try {
			const shown = () => term.screen().filter(row => row.includes("one line")).length;
			expect(shown()).toBe(0);
			// The full card starts lower than the compact line (its margin row): find the first row each time.
			const click = () =>
				term.mouse({
					row: term.screen().findIndex(row => row.trim() !== ""),
					col: 2,
					button: "left",
					action: "press",
					mods: [],
				});
			click();
			expect(shown()).toBeGreaterThan(0);
			click();
			expect(shown()).toBe(0);
		} finally {
			term.dispose();
		}
	});
});
