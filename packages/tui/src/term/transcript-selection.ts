/**
 * Mouse selection in the fullscreen transcript (see `transcript-window.ts`).
 *
 * A selection runs between two transcript cells: a block's node, a row of
 * its span (its lead, then its rows) and a column. Points name blocks, not
 * screen rows, so a selection survives scrolling and grows past the window
 * while the user drags with the wheel or at the window's edges. The window
 * draws the selected cells in reverse video; the selected text is plain
 * (escapes and image placeholder cells dropped, trailing blanks trimmed).
 */
import type { UiNode } from "../node";
import { sliceColumns, visibleWidth } from "../text/width";
import type { TranscriptRows, WindowBlock } from "./transcript-window";

/** A transcript cell. */
export interface TranscriptPoint {
	readonly node: UiNode;
	/** Row of the node's span (its lead, then its rows). */
	readonly offset: number;
	readonly col: number;
}

/** The transcript row each window row shows; null below the content. */
export type WindowRowMap = readonly ({
	readonly node: UiNode;
	readonly index: number;
	readonly offset: number;
} | null)[];

/** A selection's ends in reading order; `end.col` is inclusive. */
interface Range {
	readonly start: { readonly index: number; readonly offset: number; readonly col: number };
	readonly end: { readonly index: number; readonly offset: number; readonly col: number };
}

/** Kitty image placeholder cells (U+10EEEE with their row/column diacritics): no text to copy. */
const PLACEHOLDER = /\u{10EEEE}\p{M}*/gu;
const REVERSE = "\x1b[7m";
const REVERSE_OFF = "\x1b[27m";

/** The rows of `blocks` (a window of `capacity` rows) as transcript rows. */
export function windowRowMap(rows: TranscriptRows, blocks: readonly WindowBlock[], capacity: number): WindowRowMap {
	const map: WindowRowMap[number][] = Array.from({ length: capacity }, () => null);
	for (const { index, block, top } of blocks) {
		const first = top - rows.lead(index);
		const node = rows.node(index);
		for (let row = Math.max(0, first); row < Math.min(capacity, top + block.rows.length); row++) {
			map[row] = { node, index, offset: row - first };
		}
	}
	return map;
}

/** The cell under window cell (`row`, `col`); rows below the content take the end of its last row. */
export function pointAt(map: WindowRowMap, row: number, col: number): TranscriptPoint | undefined {
	const clamped = Math.min(Math.max(0, row), map.length - 1);
	for (let at = clamped; at >= 0; at--) {
		const entry = map[at];
		if (entry) return { node: entry.node, offset: entry.offset, col: at === clamped ? Math.max(0, col) : Infinity };
	}
	return undefined;
}

/** `a` and `b` in reading order; undefined when either block left the transcript. */
function ordered(rows: TranscriptRows, a: TranscriptPoint, b: TranscriptPoint): Range | undefined {
	const first = { index: rows.indexOf(a.node), offset: a.offset, col: a.col };
	const second = { index: rows.indexOf(b.node), offset: b.offset, col: b.col };
	if (first.index === -1 || second.index === -1) return undefined;
	const before =
		first.index !== second.index
			? first.index < second.index
			: first.offset !== second.offset
				? first.offset < second.offset
				: first.col <= second.col;
	return before ? { start: first, end: second } : { start: second, end: first };
}

/** Columns `[from, to)` of transcript row (`index`, `offset`) the range covers, in a row `width` cells wide. */
function covered(range: Range, index: number, offset: number, width: number): readonly [number, number] | undefined {
	const { start, end } = range;
	if (index < start.index || (index === start.index && offset < start.offset)) return undefined;
	if (index > end.index || (index === end.index && offset > end.offset)) return undefined;
	const from = index === start.index && offset === start.offset ? start.col : 0;
	const to = index === end.index && offset === end.offset ? end.col + 1 : width;
	return [Math.min(from, width), Math.min(to, width)];
}

/**
 * Draw the selection between `a` and `b` over the window's `lines` in reverse video. Returns false
 * (drawing nothing) when either end's block left the transcript.
 */
export function highlightSelection(
	lines: string[],
	map: WindowRowMap,
	rows: TranscriptRows,
	a: TranscriptPoint,
	b: TranscriptPoint,
): boolean {
	const range = ordered(rows, a, b);
	if (!range) return false;
	for (let row = 0; row < lines.length; row++) {
		const entry = map[row];
		if (!entry) continue;
		const line = lines[row]!;
		const width = visibleWidth(line);
		const cols = covered(range, entry.index, entry.offset, width);
		if (!cols || cols[0] >= cols[1]) continue;
		const [from, to] = cols;
		// A reset inside the selected cells would end the reverse video: reopen it after each.
		const middle = sliceColumns(line, from, to).replace(/\x1b\[0?m/g, reset => `${reset}${REVERSE}`);
		lines[row] = `${sliceColumns(line, 0, from)}${REVERSE}${middle}${REVERSE_OFF}${sliceColumns(line, to, width)}`;
	}
	return true;
}

/**
 * The plain text between `a` and `b`, one line per transcript row; empty when either block is gone.
 * Lines taken from their row's start lose the indent they all share (the transcript's margin), so
 * relative indentation (code) survives.
 */
export function selectionText(rows: TranscriptRows, a: TranscriptPoint, b: TranscriptPoint): string {
	const range = ordered(rows, a, b);
	if (!range) return "";
	const out: { text: string; whole: boolean }[] = [];
	for (let index = range.start.index; index <= range.end.index; index++) {
		const block = rows.block(index);
		if (block.rows.length === 0) continue;
		const lead = rows.lead(index);
		for (let offset = 0; offset < lead + block.rows.length; offset++) {
			const plain = offset < lead ? "" : Bun.stripANSI(block.rows[offset - lead]!);
			const cols = covered(range, index, offset, visibleWidth(plain));
			if (!cols) continue;
			const text = sliceColumns(plain, cols[0], cols[1]).replace(PLACEHOLDER, "").trimEnd();
			out.push({ text, whole: cols[0] === 0 });
		}
	}
	let margin = Infinity;
	for (const { text, whole } of out)
		if (whole && text) margin = Math.min(margin, text.length - text.trimStart().length);
	return out.map(({ text, whole }) => (whole && margin !== Infinity ? text.slice(margin) : text)).join("\n");
}
