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
import { type Accessor, computed, type JSXNode, type Signal, signal, type UiNode, untrack } from "@oh-my-pi/pi-tui";
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

/** The summary row node inside a run's first block (`role: "omp.tool.run"`), when it draws one. */
function summaryNode(node: UiNode): UiNode | undefined {
	if ((node.props() as { role?: string }).role === "omp.tool.run") return node;
	for (const child of node.children()) {
		const found = summaryNode(child);
		if (found) return found;
	}
	return undefined;
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
	/** Bumped whenever expand-all flips or every run is folded: it resets every choice made by hand. */
	readonly #epoch: Accessor<number>;
	/** Opens or folds of every run at once (the toggle-all key). */
	readonly #resets = signal(0);
	/** Every run opened or folded at once, with its epoch: until the next one, runs follow it unless set by hand. */
	readonly #all = signal<{ readonly open: boolean; readonly epoch: number } | undefined>(undefined);
	/**
	 * Each tool block's run (its blocks in order). Weak: the last computed value lingers until the
	 * next read, and blocks the transcript dropped must not live on in it.
	 */
	readonly #runs: Accessor<WeakMap<TranscriptBlock, readonly TranscriptBlock[]>>;

	constructor(host: ToolRunsHost) {
		this.#host = host;
		let epoch = 0;
		let last: boolean | undefined;
		this.#epoch = computed(() => {
			const expandAll = host.expandAll();
			if (last !== undefined && expandAll !== last) epoch++;
			last = expandAll;
			return epoch + this.#resets();
		});
		this.#runs = computed(() => {
			const members = this.#members();
			const runs = new WeakMap<TranscriptBlock, readonly TranscriptBlock[]>();
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
		const epoch = this.#epoch();
		const choice = this.#choiceOf(first)();
		if (choice !== undefined && choice.epoch === epoch) return choice.open;
		const all = this.#all();
		return all !== undefined && all.epoch === epoch ? all.open : this.#host.expandAll();
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

	/**
	 * Open or fold `block`'s run (the newest-card key, while collapsing): "opened" or "folded";
	 * undefined when not collapsing or `block` is in no run.
	 */
	toggleRun(block: TranscriptBlock): "opened" | "folded" | undefined {
		if (!untrack(this.#host.collapse)) return undefined;
		const run = untrack(this.#runs).get(block);
		if (!run) return undefined;
		const open = !untrack(() => this.#open(run[0]!));
		this.#setOpen(run, open);
		return open ? "opened" : "folded";
	}

	/**
	 * Open or fold every run (the toggle-all key): folds them all when any is open, else opens them
	 * all (cards keep their own folds). Undefined when tool activity is not collapsed.
	 */
	toggleAll(): "opened" | "folded" | undefined {
		if (!untrack(this.#host.collapse)) return undefined;
		const runs = untrack(this.#runs);
		const members = [...untrack(this.#members).keys()];
		const anyOpen = members.some(block => {
			const first = runs.get(block)?.[0];
			return first !== undefined && untrack(() => this.#open(first));
		});
		this.#resets.set(untrack(this.#resets) + 1);
		this.#all.set({ open: !anyOpen, epoch: untrack(this.#epoch) });
		this.#host.redraw(members);
		return anyOpen ? "folded" : "opened";
	}

	/**
	 * The summary row to pin on the fullscreen window's top row while `block` (at row `row` of it)
	 * is the first one shown: its run's, when the run is open and its own row scrolled away.
	 */
	stickyHead(block: TranscriptBlock, row: number): UiNode | undefined {
		if (!this.#host.collapse()) return undefined;
		const run = this.#runs().get(block);
		const first = run?.[0];
		if (!first || (block === first && row <= 0) || !this.#open(first)) return undefined;
		return summaryNode(first.node);
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
