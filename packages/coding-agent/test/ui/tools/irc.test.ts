import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createRoot, createSurface, isUiNode, signal, type UiNode } from "@oh-my-pi/pi-tui";
import { createTerminalDriver } from "@oh-my-pi/pi-tui/driver/index";
import { TermBackend } from "@oh-my-pi/pi-tui/term/backend";
import { firstCellDiff } from "@oh-my-pi/pi-tui/testing/cells";
import { corpusEnvironment, describeTree, firstDiff, stageNative } from "@oh-my-pi/pi-tui/testing/corpus";
import { memoryTerminal } from "@oh-my-pi/pi-tui/testing/memory-terminal";
import { paintNode, staticEnvironment } from "@oh-my-pi/pi-tui/term/paint";
import { loadThemeSync } from "@oh-my-pi/pi-tui/theme/loader";
import { currentTheme, setCurrentTheme } from "@oh-my-pi/pi-tui/theme/runtime";
import "../../../src/ui/styles/messages/panel";
import "../../../src/ui/styles/tools/irc";
import { type IrcMessage, IrcMessageCard } from "../../../src/ui/tools/irc";
import { IrcMessageBlock } from "../../../src/ui/transcript/messages/async-cards";
import { loadScreenCase, screenCaseFiles } from "./screens";

const DIR = "tools/irc-card";
const files = screenCaseFiles(DIR);

const originalTheme = currentTheme();
afterEach(() => setCurrentTheme(originalTheme));

test("IRC message cards use the active preset's directional glyphs in native and terminal headings", () => {
	const theme = loadThemeSync("dark", { symbolPreset: "nerd" });
	setCurrentTheme(theme);
	const env = staticEnvironment(theme);
	createRoot(dispose => {
		try {
			const node = IrcMessageCard({ message: { kind: "relay", from: "Anna", to: "Ben" }, expanded: false });
			if (!isUiNode(node)) throw new Error("Expected an IRC message card");
			expect(describeTree(node, env)).toMatchObject({
				k: "card",
				p: { role: "omp.irc.relay", head: [{ s: "toolTitle strong", t: "IRC Anna  Ben" }] },
			});
			const ascii = staticEnvironment(loadThemeSync("dark", { symbolPreset: "ascii" }));
			expect(paintNode(ascii, node, 100).rows.map(row => Bun.stripANSI(row))).toEqual(["# IRC Anna -> Ben"]);
		} finally {
			dispose();
		}
	});
});

test("a click on a transcript IRC card's title row folds that card, through its tool-activity wrapper", async () => {
	const theme = loadThemeSync("dark", { symbolPreset: "ascii" });
	setCurrentTheme(theme);
	const memory = memoryTerminal({ columns: 60, rows: 12 });
	const driver = createTerminalDriver(memory.options);
	const body = ["one", "two", "three", "four", "five"].join("\n");
	const surface = createSurface(() => ({
		dock: IrcMessageBlock({
			message: { customType: "irc:incoming", details: { from: "Anna", message: body }, timestamp: Date.now() },
			expanded: false,
			visible: true,
		}),
	}));
	const backend = new TermBackend({ surface, driver, theme: () => theme });
	const shown = (): string[] =>
		paintNode(backend.environment, surface.dock()[0]!, 60).rows.map(row => Bun.stripANSI(row));
	await driver.start();
	try {
		backend.start();
		backend.renderNow();
		expect(shown().some(row => row.includes("five"))).toBe(false);
		// The title row is the card's only hit: find it with pointer motion.
		let head = 0;
		for (let row = 1; row <= 12 && head === 0; row++) {
			memory.feed(`\x1b[<35;3;${row}M`);
			if (backend.environment.hover?.()) head = row;
		}
		expect(head).toBeGreaterThan(0);
		memory.feed(`\x1b[<0;3;${head}M`);
		backend.renderNow();
		expect(shown().some(row => row.includes("five"))).toBe(true);
	} finally {
		backend.stop();
		await driver.stop();
		surface.dispose();
	}
});

describe.skipIf(files.length === 0)(`${DIR} corpus`, () => {
	for (const file of files) {
		const corpusCase = loadScreenCase(DIR, file);
		const inputs = corpusCase.inputs as { card: IrcMessage; nowMs: number };
		test(file, () => {
			const env = corpusEnvironment(corpusCase.theme);
			const expanded = signal(false);
			setSystemTime(new Date(inputs.nowMs));
			try {
				createRoot(dispose => {
					const node = IrcMessageCard({ message: inputs.card, expanded });
					if (!isUiNode(node)) throw new Error("irc card: node expected");
					const failures: string[] = [];
					corpusCase.stages.forEach((stage, index) => {
						expanded.set(stage.label === "expanded");
						const native = firstDiff(stageNative(corpusCase, index), describeTree(node as UiNode, env));
						if (native) failures.push(`${stage.label} native: ${native}`);
						for (const width of corpusCase.widths) {
							const diff = firstCellDiff(
								stage.rows[String(width)] ?? [],
								paintNode(env, node as UiNode, width).rows,
							);
							if (diff) failures.push(`${stage.label} @${width}: ${diff}`);
						}
					});
					dispose();
					expect(failures).toEqual([]);
				});
			} finally {
				setSystemTime();
			}
		});
	}
});
