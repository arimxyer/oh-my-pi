import { afterEach, expect, test } from "bun:test";
import { createSurface, untrack } from "@oh-my-pi/pi-tui";
import { createTerminalDriver } from "@oh-my-pi/pi-tui/driver/index";
import { jsx } from "@oh-my-pi/pi-tui/jsx-runtime";
import { TermBackend } from "@oh-my-pi/pi-tui/term/backend";
import { staticEnvironment } from "@oh-my-pi/pi-tui/term/paint";
import { memoryTerminal } from "@oh-my-pi/pi-tui/testing/memory-terminal";
import { loadThemeSync } from "@oh-my-pi/pi-tui/theme/loader";
import { getKeybindings, KeybindingsManager, setKeybindings } from "../../../src/config/keybindings/keybindings";
import "../../../src/ui/styles/messages/panel";
import { defaultPresenter } from "../../../src/ui/tools/default";
import type { ToolResult } from "../../../src/ui/tools/contract";
import { ToolBlock, ToolCall } from "../../../src/ui/transcript/tool-block";
import { plainToolRows, type ToolCaseInputs, type ToolScreen, toolScreenSuite } from "./screens";

/** The corpus drove the generic card with `{ label, args }` and a `{ skipped }` result flag. */
interface DefaultInput {
	readonly label: string;
	readonly args: unknown;
}

export const defaultScreen: ToolScreen = {
	dir: "tools/default",
	name: "mystery_tool",
	presenter: defaultPresenter,
	adapter: {
		args: (inputs: ToolCaseInputs) => (inputs.args as DefaultInput).args,
		result: (inputs: ToolCaseInputs): ToolResult | undefined => inputs.result,
		renderContext: (inputs: ToolCaseInputs) => ({
			label: (inputs.args as DefaultInput).label,
		}),
	},
};

toolScreenSuite(defaultScreen);

const originalBindings = getKeybindings();
afterEach(() => setKeybindings(originalBindings));

test("generic card rows use the preset's branch and advertise the rebound expand key", () => {
	setKeybindings(KeybindingsManager.inMemory({ "app.tools.expand": "f9" }));
	const env = staticEnvironment(loadThemeSync("dark", { symbolPreset: "ascii" }));
	const call = new ToolCall({
		id: "custom-1",
		name: "custom",
		presenter: defaultPresenter,
		args: { query: "weather" },
	});
	expect(plainToolRows(call, env)).toContain(`  '- query="weather"`);
	call.setExecutionStarted();
	call.updateResult({ content: [{ type: "text", text: "Light rain" }] }, false);
	expect(plainToolRows(call, env)).toContain(" [click title or F9: Expand]");
});

test("a click on a transcript tool card's title row folds that card, not on its padding", async () => {
	const call = new ToolCall({ id: "custom-2", name: "custom", presenter: defaultPresenter, args: { query: "x" } });
	call.setExecutionStarted();
	const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
	call.updateResult({ content: [{ type: "text", text }] }, false);
	call.seal();
	const memory = memoryTerminal({ columns: 80, rows: 60 });
	const driver = createTerminalDriver(memory.options);
	const surface = createSurface(() => ({
		dock: jsx("col", { role: "omp.transcript", children: ToolBlock({ call }) }),
	}));
	const backend = new TermBackend({ surface, driver, theme: () => loadThemeSync("dark", { symbolPreset: "ascii" }) });
	await driver.start();
	try {
		backend.start();
		backend.renderNow();
		expect(untrack(call.state).expanded).toBe(false);
		let head = 0;
		for (let row = 1; row <= 60 && head === 0; row++) {
			memory.feed(`\x1b[<35;3;${row}M`);
			if (backend.environment.hover?.()) head = row;
		}
		expect(head).toBeGreaterThan(0);
		memory.feed(`\x1b[<0;3;${head}M`);
		expect(untrack(call.state).expanded).toBe(true);
	} finally {
		backend.stop();
		await driver.stop();
		surface.dispose();
	}
});
