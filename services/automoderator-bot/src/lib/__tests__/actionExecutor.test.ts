import { beforeEach, expect, test, vi } from 'vitest';
import { executeAction } from '../actionExecutor.js';
import { discordErrors, dryRunSuppressions, moderationActions, register } from '../metrics.js';

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
	discordErrors.reset();
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

	await executeAction({ action: 'mute', guildId: '9', source: 'command', previewOnly: true, execute: vi.fn() }, logger);

	expect(resolveDryRun).toHaveBeenCalledWith('9', true);
});

test('a rejected Discord call is rethrown, and counted as an error rather than an action', async () => {
	resolveDryRun.mockResolvedValue(false);
	const execute = vi.fn().mockRejectedValue(Object.assign(new Error('Missing Permissions'), { status: 403 }));

	await expect(executeAction({ action: 'ban', guildId: '1', source: 'command', execute }, logger)).rejects.toThrow(
		'Missing Permissions',
	);

	// The point of the split: "we banned N people" must never include the ones Discord refused.
	expect(await counterValue('automoderator_moderation_actions_total')).toBe(0);
	expect(await counterValue('automoderator_discord_errors_total')).toBe(1);
});

test('a nullish rejection is still counted, and rethrown unchanged', async () => {
	resolveDryRun.mockResolvedValue(false);

	for (const rejection of [undefined, null]) {
		discordErrors.reset();
		const execute = vi.fn().mockRejectedValue(rejection);

		await expect(executeAction({ action: 'delete', guildId: '1', source: 'automod', execute }, logger)).rejects.toBe(
			rejection,
		);

		expect(await counterValue('automoderator_discord_errors_total')).toBe(1);
	}
});

test('a transport failure with no HTTP status still lands under a stable label', async () => {
	resolveDryRun.mockResolvedValue(false);
	const execute = vi.fn().mockRejectedValue(new Error('socket hang up'));

	await expect(executeAction({ action: 'kick', guildId: '1', source: 'command', execute }, logger)).rejects.toThrow(
		'socket hang up',
	);

	// `status: 'unknown'` rather than dropping the sample -- an outage that never reaches Discord is exactly
	// when the counter needs to move.
	expect(await counterValue('automoderator_discord_errors_total')).toBe(1);
});
