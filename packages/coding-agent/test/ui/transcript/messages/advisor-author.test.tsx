/** @jsxImportSource @oh-my-pi/pi-tui */
/**
 * An advisor card names who wrote its notes: one author (advisor name and model)
 * in the head, or each note's own when they differ. The model never reaches the
 * agent-facing `<advisory>` text.
 */
import { describe, expect, test } from "bun:test";
import { createRoot, isUiNode, signal } from "@oh-my-pi/pi-tui";
import { paintNode, staticEnvironment } from "@oh-my-pi/pi-tui/term/paint";
import { stripEscapes } from "@oh-my-pi/pi-tui/text/ansi";
import { loadThemeSync } from "@oh-my-pi/pi-tui/theme/loader";
import { formatAdvisorBatchContent } from "../../../../src/advisor/advise-tool";
import type { AdvisorNote } from "../../../../src/session/transcript/messages";
import { AdvisorMessage } from "../../../../src/ui/transcript/messages/advisor-message";
import "../../../../src/ui/styles/messages";

const env = staticEnvironment(loadThemeSync("dark"));

function rows(notes: AdvisorNote[]): string[] {
	return createRoot(dispose => {
		try {
			const node = <AdvisorMessage details={{ notes }} expanded={signal(true)} />;
			if (!isUiNode(node)) throw new Error("expected one node");
			return paintNode(env, node, 120).rows.map(row => stripEscapes(row).trimEnd());
		} finally {
			dispose();
		}
	});
}

describe("advisor note author", () => {
	test("puts a single author's model in the head, and each author on its note when they differ", () => {
		const [head, note] = rows([{ note: "Check the cache.", severity: "concern", model: "gpt-6.1-sol" }]);
		expect(head).toContain("Advisor gpt-6.1-sol · 1 note");
		expect(note).not.toContain("gpt-6.1-sol");

		const mixed = rows([
			{ note: "Check the cache.", advisor: "security", model: "gpt-6.1-sol" },
			{ note: "Tighten the spacing.", advisor: "design", model: "claude-opus-5-5" },
		]);
		expect(mixed[0]).not.toContain("gpt-6.1-sol");
		expect(mixed.find(row => row.includes("Check the cache."))).toContain("[security · gpt-6.1-sol]");
		expect(mixed.find(row => row.includes("Tighten the spacing."))).toContain("[design · claude-opus-5-5]");
	});

	test("keeps the model out of the agent-facing advisory", () => {
		const content = formatAdvisorBatchContent([{ note: "Check the cache.", advisor: "security", model: "gpt-6.1-sol" }]);
		expect(content).toContain('advisor="security"');
		expect(content).not.toContain("gpt-6.1-sol");
	});
});
