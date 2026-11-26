/**
 * Transcript containers.
 *
 * - `col` `omp.transcript`: the blocks, each without its blank edge rows,
 *   set off by one blank row (blocks drawing nothing take none; blocks marked
 *   `term.compact` pack against each other).
 * - `col` `omp.activity`: its blocks stacked.
 * - `col` `omp.panel`: a blank row, each section followed by a blank row,
 *   then the footer line as styled.
 *
 * Bare `text` and `md` blocks sit one cell in, like the transcript's prose.
 */
import type { UiNode } from "@oh-my-pi/pi-tui";
import { type Block, defineRolePainter, type Hit, type PaintContext } from "@oh-my-pi/pi-tui/term/paint";
import { offsetBlock, stack } from "@oh-my-pi/pi-tui/term/painters/layout";
import { stripEscapes } from "@oh-my-pi/pi-tui/text/ansi";
import { replaceTabs, wrap } from "@oh-my-pi/pi-tui/text/width";
import { propsOf, termOf } from "./fill";

/** A block as painted (hits kept); bare `text` and `md` blocks one cell in from both edges. */
function childBlock(cx: PaintContext, node: UiNode): Block {
	const bare = (node.kind === "text" || node.kind === "md") && propsOf<{ role: string }>(node).role === undefined;
	if (!bare) return cx.paint(node, cx.width);
	const block = cx.paint(node, Math.max(1, cx.width - 2));
	const { hits } = offsetBlock(block, 0, 1);
	return { rows: block.rows.map(row => ` ${row}`), ...(hits ? { hits } : {}) };
}

/** A block's rows; bare `text` and `md` blocks one cell in from both edges. */
export function blockRows(cx: PaintContext, node: UiNode): readonly string[] {
	return childBlock(cx, node).rows;
}

function blank(row: string): boolean {
	return stripEscapes(row).trim() === "";
}

function paintTranscript(node: UiNode, cx: PaintContext): Block {
	const rows: string[] = [];
	const hits: Hit[] = [];
	let previousCompact = false;
	for (const child of node.children()) {
		const block = childBlock(cx, child);
		// Without its blank edge rows.
		let start = 0;
		let end = block.rows.length;
		while (start < end && blank(block.rows[start]!)) start++;
		while (end > start && blank(block.rows[end - 1]!)) end--;
		if (start === end) continue;
		const compact = termOf<{ compact: boolean }>(child).compact === true;
		if (rows.length > 0 && !(compact && previousCompact)) rows.push("");
		const shifted = offsetBlock(block, rows.length - start, 0).hits ?? [];
		for (const hit of shifted) if (hit.row >= rows.length && hit.row < rows.length + end - start) hits.push(hit);
		rows.push(...block.rows.slice(start, end));
		previousCompact = compact;
	}
	return { rows, ...(hits.length > 0 ? { hits } : {}) };
}

function paintActivity(node: UiNode, cx: PaintContext): Block {
	const block = stack(
		node.children().map(child => childBlock(cx, child)),
		0,
	);
	return { rows: block.rows, ...(block.hits ? { hits: block.hits } : {}) };
}

function paintPanel(node: UiNode, cx: PaintContext): Block {
	const rows: string[] = [""];
	const hits: Hit[] = [];
	for (const child of node.children()) {
		if (propsOf<{ role: string }>(child).role === "omp.panel.footer") {
			const footer = termOf<{ footer: string }>(child).footer ?? "";
			rows.push(...wrap(replaceTabs(footer), cx.width));
			continue;
		}
		const section = stack(
			child.children().map(member => childBlock(cx, member)),
			0,
		);
		if (section.rows.length === 0) continue;
		const { hits: shifted } = offsetBlock(section, rows.length, 0);
		if (shifted) hits.push(...shifted);
		rows.push(...section.rows, "");
	}
	return { rows, ...(hits.length > 0 ? { hits } : {}) };
}

defineRolePainter("col", "omp.transcript", paintTranscript);
defineRolePainter("col", "omp.activity", paintActivity);
defineRolePainter("col", "omp.panel", paintPanel);
