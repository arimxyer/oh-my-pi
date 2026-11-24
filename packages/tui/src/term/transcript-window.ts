/**
 * The fullscreen transcript: the `main` region drawn as a scrollable window
 * on the alternate screen instead of retiring into terminal history (the
 * backend's `fullscreen` option).
 *
 * The transcript reads as one column of rows, block by block: each non-empty
 * block's span is its lead (the separator rows above it) followed by its
 * rows; an empty block spans nothing. The window shows `capacity` of those
 * rows. It follows the tail until the user scrolls; then its top row is
 * anchored to a block (a node and an offset into its span), so content that
 * grows or arrives below the window does not move what the user reads.
 * Scrolling back down to the tail follows it again.
 *
 * Blocks are painted on demand (the paint cache keeps them cheap): only the
 * window's blocks and the ones a scroll walks across are painted.
 */
import type { UiNode } from "../node";
import type { Block } from "./paint";

/** The transcript, block by block, at the window's width. */
export interface TranscriptRows {
	readonly count: number;
	node(index: number): UiNode;
	indexOf(node: UiNode): number;
	block(index: number): Block;
	/** Blank rows separating non-empty block `index` from the non-empty block above it. */
	lead(index: number): number;
}

/** The window's top row while it does not follow the tail. */
export interface TranscriptAnchor {
	readonly node: UiNode;
	/** Rows into the node's span (its lead, then its rows). */
	readonly offset: number;
}

/** A block the window shows. */
export interface WindowBlock {
	readonly index: number;
	readonly block: Block;
	/** Window row of the block's first row (negative when it starts above the window). */
	readonly top: number;
}

/** What the window shows. */
export interface TranscriptWindow {
	/** At most `capacity` rows, top-aligned. */
	readonly rows: string[];
	readonly blocks: WindowBlock[];
	/** The anchor to keep: null when the window reaches the tail (it follows it). */
	readonly anchor: TranscriptAnchor | null;
}

interface Position {
	readonly index: number;
	readonly offset: number;
}

function span(rows: TranscriptRows, index: number): number {
	const height = rows.block(index).rows.length;
	return height === 0 ? 0 : rows.lead(index) + height;
}

/** `count` rows above `from`, stopping at the first row. */
function up(rows: TranscriptRows, from: Position, count: number): Position {
	let { index, offset } = from;
	let left = count;
	while (left > 0) {
		if (offset >= left) return { index, offset: offset - left };
		left -= offset;
		let previous = index - 1;
		while (previous >= 0 && span(rows, previous) === 0) previous--;
		if (previous < 0) return { index, offset: 0 };
		index = previous;
		offset = span(rows, previous);
	}
	return { index, offset };
}

/** `count` rows below `from`; past the last row is the end (`index === rows.count`). */
function down(rows: TranscriptRows, from: Position, count: number): Position {
	let { index, offset } = from;
	offset += count;
	while (index < rows.count) {
		const height = span(rows, index);
		if (offset < height) return { index, offset };
		offset -= height;
		index++;
	}
	return { index: rows.count, offset: 0 };
}

/** The top row of a window of `capacity` rows ending at the transcript's last row. */
function tailTop(rows: TranscriptRows, capacity: number): Position {
	return up(rows, { index: rows.count, offset: 0 }, capacity);
}

function resolve(rows: TranscriptRows, anchor: TranscriptAnchor | null, capacity: number): Position {
	const index = anchor ? rows.indexOf(anchor.node) : -1;
	if (!anchor || index === -1) return tailTop(rows, capacity);
	return { index, offset: Math.min(anchor.offset, Math.max(0, span(rows, index) - 1)) };
}

/** Rows of the window starting at `top`, and whether they reach the transcript's last row. */
function fill(
	rows: TranscriptRows,
	top: Position,
	capacity: number,
): { readonly rows: string[]; readonly blocks: WindowBlock[]; readonly end: boolean } {
	const out: string[] = [];
	const blocks: WindowBlock[] = [];
	let index = top.index;
	let offset = top.offset;
	for (; index < rows.count && out.length < capacity; index++, offset = 0) {
		const block = rows.block(index);
		if (block.rows.length === 0) continue;
		const lead = rows.lead(index);
		const height = lead + block.rows.length;
		blocks.push({ index, block, top: out.length - offset + lead });
		let row = offset;
		for (; row < height && out.length < capacity; row++) out.push(row < lead ? "" : block.rows[row - lead]!);
		// Cut inside this block: rows of it remain below the window.
		if (row < height) return { rows: out, blocks, end: false };
	}
	// Remaining blocks may all be empty: they draw nothing below the window.
	while (index < rows.count && span(rows, index) === 0) index++;
	return { rows: out, blocks, end: index >= rows.count };
}

/** The window of `capacity` rows at `anchor` (null: the tail). */
export function transcriptWindow(
	rows: TranscriptRows,
	anchor: TranscriptAnchor | null,
	capacity: number,
): TranscriptWindow {
	if (capacity <= 0) return { rows: [], blocks: [], anchor };
	const top = resolve(rows, anchor, capacity);
	const view = fill(rows, top, capacity);
	if (anchor && !view.end) return { rows: view.rows, blocks: view.blocks, anchor };
	// The tail is in view: follow it (a window that reached it from an anchor shows the last page).
	const tail = anchor ? fill(rows, tailTop(rows, capacity), capacity) : view;
	return { rows: tail.rows, blocks: tail.blocks, anchor: null };
}

/** Scroll a window of `capacity` rows by `delta` rows (negative: up); returns the anchor to keep. */
export function scrollTranscript(
	rows: TranscriptRows,
	anchor: TranscriptAnchor | null,
	capacity: number,
	delta: number,
): TranscriptAnchor | null {
	if (capacity <= 0 || delta === 0) return anchor;
	const top = resolve(rows, anchor, capacity);
	const next = delta < 0 ? up(rows, top, -delta) : down(rows, top, delta);
	if (next.index >= rows.count) return null;
	return transcriptWindow(rows, { node: rows.node(next.index), offset: next.offset }, capacity).anchor;
}
