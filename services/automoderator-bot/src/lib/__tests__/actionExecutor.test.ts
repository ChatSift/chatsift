import { beforeEach, expect, test, vi } from 'vitest';
import { executeAction } from '../actionExecutor.js';
import { dryRunSuppressions, moderationActions, register } from '../metrics.js';

const resolveDryRun = vi.fn();

// `dryRun.ts` reads ENV and the database; what's under test here is the seam's own behaviour given an answer,
// so it's stubbed rather than exercised. Its own resolution order is tested in `dryRun.test.ts`.
vi.mock('../dryRun.js', () => ({
	resolveDryRun: async (...args: unknown[]) => resolveDryRun(...args),
}));

const logger = { info: vi.fn(), error: vi.fn() } as never;

async function counterValue(name: string): Promise<number> {
	const metrics = await register.getMetricsAsJSON();
	const metric = metrics.find((candidate) => candidate.name === name);
	return (metric?.values ?? []).reduce((total: number, sample: { value: number }) => total + sample.value, 0);
}

beforeEach(() => {
	resolveDryRun.mockReset();
	moderationActions.reset();
	dryRunSuppressions.reset();
});

test('live mode runs the Discord call', async () => {
	resolveDryRun.mockResolvedValue(false);
	const execute = vi.fn().mockResolvedValue(undefined);

	const result = await executeAction(
		{ action: 'ban', guildId: '1', source: 'command', targetId: '2', execute },
		logger,
	);

	expect(execute).toHaveBeenCalledOnce();
	expect(result.suppressed).toBe(false);
	expect(await counterValue('automoderator_dry_run_suppressions_total')).toBe(0);
});

test('dry-run never runs the Discord call', async () => {
	resolveDryRun.mockResolvedValue(true);
	const execute = vi.fn().mockResolvedValue(undefined);

	const result = await executeAction(
		{ action: 'ban', guildId: '1', source: 'command', targetId: '2', execute },
		logger,
	);

	// The entire contract of the seam: `execute` is the only thing that talks to Discord, and in dry-run it is
	// not called at all -- not called-and-ignored, not called with a flag.
	expect(execute).not.toHaveBeenCalled();
	expect(result.suppressed).toBe(true);
	expect(await counterValue('automoderator_dry_run_suppressions_total')).toBe(1);
});

test('an action is counted either way, labelled by whether it was suppressed', async () => {
	resolveDryRun.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
	const execute = vi.fn().mockResolvedValue(undefined);

	await executeAction({ action: 'kick', guildId: '1', source: 'ladder', execute }, logger);
	await executeAction({ action: 'kick', guildId: '1', source: 'ladder', execute }, logger);

	// Intent and enforcement on one axis -- two decisions, one of which happened.
	expect(await counterValue('automoderator_moderation_actions_total')).toBe(2);
});

test('the invocation override is passed through to resolution', async () => {
	resolveDryRun.mockResolvedValue(true);

	await executeAction(
		{ action: 'mute', guildId: '9', source: 'command', previewOnly: true, execute: vi.fn() },
		logger,
	);

	expect(resolveDryRun).toHaveBeenCalledWith('9', true);
});

test('a failed Discord call is rethrown, after being counted', async () => {
	resolveDryRun.mockResolvedValue(false);
	const execute = vi.fn().mockRejectedValue(new Error('403'));

	await expect(executeAction({ action: 'ban', guildId: '1', source: 'command', execute }, logger)).rejects.toThrow(
		'403',
	);

	// Counted before the call, so a failure is still visible as an attempted action rather than vanishing.
	expect(await counterValue('automoderator_moderation_actions_total')).toBe(1);
});
