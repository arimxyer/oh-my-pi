import { expect, test } from "bun:test";
import * as path from "node:path";

interface ProbeResult {
	readonly calls: number;
	readonly live: number;
}

const probePath = path.join(import.meta.dir, "fixtures", "tool-runs-retention-probe.ts");

// Tool calls the transcript cleared must be collectable, whatever the collapsed-run bookkeeping
// remembered about them. JSC's conservative stack scan and its concurrent JIT can pin a few cells
// in any one process (see mcp-refresh-retention.test.ts), so the probe runs in fresh processes with
// a synchronous JIT and the first run that settles wins. A real leak pins every call, every run.
const MAX_ATTEMPTS = 4;

async function runProbe(collapse: "on" | "off"): Promise<ProbeResult> {
	const proc = Bun.spawn([process.execPath, probePath, collapse], {
		cwd: path.join(import.meta.dir, "../../.."),
		env: { ...process.env, BUN_JSC_useConcurrentJIT: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	return JSON.parse(stdout) as ProbeResult;
}

for (const collapse of ["off", "on"] as const) {
	test(`cleared tool calls are released (collapsed tool activity ${collapse})`, async () => {
		let last: ProbeResult | undefined;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			last = await runProbe(collapse);
			if (last.live === 0) return;
		}
		expect(last!.live, `unsettled after ${MAX_ATTEMPTS} attempts`).toBe(0);
	}, 60_000);
}
