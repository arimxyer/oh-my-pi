/** @jsxImportSource @oh-my-pi/pi-tui */
/**
 * Collapsed tool activity (`display.collapseToolActivity`): each run of tool
 * blocks (cards and read groups with no reply text, prompt or other block
 * between them) draws as one summary row at its first block, `▸ 5 tool calls
 * · bash ×3, edit ×2`, spinning while a member runs. A click on the row
 * (or its fold key) shows the run's blocks in place; the row stays as their
 * header and folds them again.
 *
 * A reply's block breaks a run only when it shows text: one carrying only
 * thinking or tool calls sits inside it.
 */
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { type Accessor, computed, type JSXNode, type Signal, signal, untrack } from "@oh-my-pi/pi-tui";
import type { TranscriptBlock } from "../../ui/shell";
import type { TranscriptEntry } from "../types";

/** A tool block's part in its run's summary. */
export interface ToolRunMember {
	/** Tool name per call the block draws (a read group: one `read` per read). */
	readonly names: Accessor<readonly string[]>;
	/** Whether any of its calls still runs. */
	readonly running: Accessor<boolean>;
}

/** What {@link ToolRuns} reads from the presenter. */
export interface ToolRunsHost {
	readonly blocks: Accessor<readonly TranscriptBlock[]>;
	entryOf(block: TranscriptBlock): TranscriptEntry | undefined;
	/** `display.collapseToolActivity`. */
	readonly collapse: Accessor<boolean>;
	/** Ctrl+O's expand-all: every run shows its blocks until one is folded by hand. */
	readonly expandAll: Accessor<boolean>;
	/** Rows of `blocks` may already be in terminal history: redraw it. */
	redraw(blocks: readonly TranscriptBlock[]): void;
}

function showsText(message: AssistantMessage | undefined): boolean {
	return message?.content.some(part => part.type === "text" && part.text.trim() !== "") === true;
}

/** See the module docs. */
export class ToolRuns {
	readonly #host: ToolRunsHost;
	readonly #members = signal<ReadonlyMap<TranscriptBlock, ToolRunMember>>(new Map());
	/** Runs opened or folded by hand, by their first block, with the expand-all epoch they were set in. */
	readonly #choices = new WeakMap<
		TranscriptBlock,
		Signal<{ readonly open: boolean; readonly epoch: number } | undefined>
	>();
	/** Bumped whenever expand-all flips: it resets every choice made by hand, as ctrl+o resets card folds. */
	readonly #epoch: Accessor<number>;
	/** Each tool block's run (its blocks in order). */
	readonly #runs: Accessor<ReadonlyMap<TranscriptBlock, readonly TranscriptBlock[]>>;

	constructor(host: ToolRunsHost) {
		this.#host = host;
		let epoch = 0;
		let last: boolean | undefined;
		this.#epoch = computed(() => {
			const expandAll = host.expandAll();
			if (last !== undefined && expandAll !== last) epoch++;
			last = expandAll;
			return epoch;
		});
		this.#runs = computed(() => {
			const members = this.#members();
			const runs = new Map<TranscriptBlock, readonly TranscriptBlock[]>();
			let run: TranscriptBlock[] = [];
			const close = (): void => {
				for (const block of run) runs.set(block, run);
				run = [];
			};
			for (const block of host.blocks()) {
				if (members.has(block)) {
					run.push(block);
					continue;
				}
				const entry = host.entryOf(block);
				if (entry?.kind === "assistant" && !showsText(entry.view.message())) continue;
				close();
			}
			close();
			return runs;
		});
	}

	/** `block` is a tool block of a run. */
	add(block: TranscriptBlock, member: ToolRunMember): void {
		const next = new Map(untrack(this.#members));
		next.set(block, member);
		this.#members.set(next);
	}

	/** `block` left the transcript: forget it (its call and closures go with it). */
	remove(block: TranscriptBlock | undefined): void {
		if (!block || !untrack(this.#members).has(block)) return;
		const next = new Map(untrack(this.#members));
		next.delete(block);
		this.#members.set(next);
	}

	#choiceOf(first: TranscriptBlock): Signal<{ readonly open: boolean; readonly epoch: number } | undefined> {
		let choice = this.#choices.get(first);
		if (!choice) {
			choice = signal<{ readonly open: boolean; readonly epoch: number } | undefined>(undefined);
			this.#choices.set(first, choice);
		}
		return choice;
	}

	/** Whether the run starting at `first` shows its blocks (reactive). */
	#open(first: TranscriptBlock): boolean {
		const choice = this.#choiceOf(first)();
		return choice !== undefined && choice.epoch === this.#epoch() ? choice.open : this.#host.expandAll();
	}

	#setOpen(run: readonly TranscriptBlock[], open: boolean): void {
		this.#choiceOf(run[0]!).set({ open, epoch: untrack(this.#epoch) });
		this.#host.redraw(run);
	}

	/** Whether `block` is folded into its run's summary row (reactive). */
	folded(block: TranscriptBlock | undefined): boolean {
		if (!block || !this.#host.collapse()) return false;
		const run = this.#runs().get(block);
		return run !== undefined && !this.#open(run[0]!);
	}

	/** Show the blocks of `block`'s run, when it is folded (the newest-card key opens a card inside one). */
	reveal(block: TranscriptBlock): void {
		const run = untrack(this.#runs).get(block);
		if (run && untrack(() => this.folded(block))) this.#setOpen(run, true);
	}

	/** The summary row `block` draws: its run's, when collapsing and `block` starts the run. */
	summary(block: TranscriptBlock | undefined): JSXNode {
		if (!block || !this.#host.collapse()) return undefined;
		const run = this.#runs().get(block);
		if (!run || run[0] !== block) return undefined;
		const members = this.#members();
		const counts = new Map<string, number>();
		let running = false;
		for (const member of run) {
			const info = members.get(member);
			if (!info) continue;
			for (const name of info.names()) counts.set(name, (counts.get(name) ?? 0) + 1);
			if (info.running()) running = true;
		}
		let calls = 0;
		for (const count of counts.values()) calls += count;
		if (calls === 0) return undefined;
		const shown = this.#open(block);
		const label = `${shown ? "▾" : "▸"} ${calls} tool call${calls === 1 ? "" : "s"}`;
		const detail = [...counts].map(([name, count]) => (count === 1 ? name : `${name} ×${count}`)).join(", ");
		return (
			<tool
				key="tool-run"
				name="tool-run"
				title={label}
				status={running ? "running" : "done"}
				frame="inline"
				collapsible
				collapsed={!shown}
				role="omp.tool.run"
				term={{ compact: "bare", activity: { label, detail }, running, spinning: running, expanded: shown }}
				onToggle={collapsed => this.#setOpen(run, !collapsed)}
			/>
		);
	}
}
