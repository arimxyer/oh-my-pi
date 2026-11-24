/** @jsxImportSource @oh-my-pi/pi-tui */
/**
 * Page keys in the fullscreen transcript (`tui.fullscreen`): an open completion menu pages its
 * own selection; with the menu closed the same keys scroll the transcript.
 */
import { describe, expect, test } from "bun:test";
import { createRoot } from "@oh-my-pi/pi-tui";
import { createTestTerminal } from "@oh-my-pi/pi-tui/testing/terminal";
import { Composer } from "../../../src/ui/composer";
import { fixtureProvider } from "./harness";

const settle = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("fullscreen transcript paging", () => {
	test("an open completion menu takes Page Down; a closed one leaves it to the transcript", async () => {
		await createRoot(async dispose => {
			const composer = new Composer({ autocompleteMaxVisible: 3 });
			const commands = Array.from({ length: 12 }, (_, i) => ({ value: `cmd${i}`, label: `cmd${i}` }));
			composer.setAutocomplete(fixtureProvider({ commands, files: [] }));
			const lines = Array.from({ length: 40 }, (_, i) => `line${i}`);
			const term = createTestTerminal(() => ({ main: [<rows key="out" lines={lines} />], dock: [composer.node] }), {
				columns: 60,
				rows: 14,
				fullscreen: () => true,
			});
			term.focus(composer.field);
			const screen = () => term.screen().join("\n");
			expect(screen()).toContain("line39");

			term.type("/");
			await settle();
			term.render();
			expect(screen()).toContain("cmd0");

			// The menu pages its selection (3 rows show: cmd3 comes into view only by paging).
			term.press("pageDown");
			await settle();
			term.render();
			expect(screen()).toContain("cmd3");
			expect(screen()).toContain("line39");

			// Closed, Page Up scrolls the transcript away from its tail.
			term.press("escape");
			term.press("pageUp");
			expect(screen()).not.toContain("line39");
			term.dispose();
			dispose();
		});
	});
});
