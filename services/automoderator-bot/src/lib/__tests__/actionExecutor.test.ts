import { beforeEach, expect, test, vi } from 'vitest';
import { executeAction } from '../actionExecutor.js';
import { discordErrors, moderationActions, register } from '../metrics.js';

const logger = { info: vi.fn(), error: vi.fn() } as never;

async function counterValue(name: string): Promise<number> {
	const metrics = await register.getMetricsAsJSON();
	const metric = metrics.find((candidate) => candidate.name === name);
	return (metric?.values ?? []).reduce((total: number, sample: { value: number }) => total + sample.value, 0);
}

beforeEach(() => {
	moderationActions.reset();
	discordErrors.reset();
});

test('the Discord call runs, and is counted once it has landed', async () => {
	const execute = vi.fn().mockResolvedValue(undefined);

	await executeAction({ action: 'ban', guildId: '1', source: 'command', targetId: '2', execute }, logger);

	// The entire contract of the seam: `execute` is the only thing that talks to Discord.
	expect(execute).toHaveBeenCalledOnce();
	expect(await counterValue('automoderator_moderation_actions_total')).toBe(1);
});

test('a rejected Discord call is rethrown, and counted as an error rather than an action', async () => {
	const execute = vi.fn().mockRejectedValue(Object.assign(new Error('Missing Permissions'), { status: 403 }));

	await expect(executeAction({ action: 'ban', guildId: '1', source: 'command', execute }, logger)).rejects.toThrow(
		'Missing Permissions',
	);

	// The point of the split: "we banned N people" must never include the ones Discord refused.
	expect(await counterValue('automoderator_moderation_actions_total')).toBe(0);
	expect(await counterValue('automoderator_discord_errors_total')).toBe(1);
});

test('a nullish rejection is still counted, and rethrown unchanged', async () => {
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
	const execute = vi.fn().mockRejectedValue(new Error('socket hang up'));

	await expect(executeAction({ action: 'kick', guildId: '1', source: 'command', execute }, logger)).rejects.toThrow(
		'socket hang up',
	);

	// `status: 'unknown'` rather than dropping the sample -- an outage that never reaches Discord is exactly
	// when the counter needs to move.
	expect(await counterValue('automoderator_discord_errors_total')).toBe(1);
});
