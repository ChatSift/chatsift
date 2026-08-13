import { beforeEach, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

const { fakeLogger, redisStore, redisSet, redisDel } = vi.hoisted(() => {
	const store = new Set<string>();

	return {
		fakeLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
		redisStore: store,
		// Only the NX semantics matter here, so this models them directly rather than standing up a redis.
		redisSet: vi.fn(async (key: string) => {
			if (store.has(key)) {
				return null;
			}

			store.add(key);
			return 'OK';
		}),
		redisDel: vi.fn(async (key: string) => {
			store.delete(key);
			return 1;
		}),
	};
});

vi.mock('@chatsift/backend-core', async (importActual) => {
	stubBackendCoreEnv();
	const actual = await importActual<typeof import('@chatsift/backend-core')>();

	return {
		...actual,
		getContext: () => ({ logger: fakeLogger, redis: { set: redisSet, del: redisDel } }),
	};
});

const { bootstrapGlobalCommands } = await import('../deploy.js');
const { registerCommandHandler } = await import('../commands.js');
const { default: DeployCommand } = await import('../deploy.js');

registerCommandHandler(new DeployCommand());

function fakeApi(existing: unknown[]) {
	return {
		getGlobalCommands: vi.fn(async () => existing),
		bulkOverwriteGlobalCommands: vi.fn(async (_applicationId: string, _commands: unknown[]) => undefined),
	};
}

beforeEach(() => {
	redisStore.clear();
	redisSet.mockClear();
	redisDel.mockClear();
});

test('seeds /deploy when the application has no global commands', async () => {
	const api = fakeApi([]);

	await bootstrapGlobalCommands('AMA', '123', api);

	expect(api.bulkOverwriteGlobalCommands).toHaveBeenCalledOnce();
	expect(api.bulkOverwriteGlobalCommands.mock.calls[0]![1]).toStrictEqual([new DeployCommand().data]);
});

test('does nothing when the application already has commands', async () => {
	const api = fakeApi([{ name: 'warn' }]);

	await bootstrapGlobalCommands('AMA', '123', api);

	expect(api.bulkOverwriteGlobalCommands).not.toHaveBeenCalled();
});

test('a boot that finds commands present does not lock out the next boot', async () => {
	// The #355 regression, exactly: boot 1 checks, finds the legacy command set, does nothing -- and used to
	// keep the claim for five minutes. Clearing the commands by hand and restarting then hit the claim and
	// returned before even checking, so /deploy never landed.
	await bootstrapGlobalCommands('AMA', '123', fakeApi([{ name: 'warn' }]));

	const afterClear = fakeApi([]);
	await bootstrapGlobalCommands('AMA', '123', afterClear);

	expect(afterClear.getGlobalCommands).toHaveBeenCalledOnce();
	expect(afterClear.bulkOverwriteGlobalCommands).toHaveBeenCalledOnce();
});

test('the claim is released after a successful bootstrap too', async () => {
	await bootstrapGlobalCommands('AMA', '123', fakeApi([]));

	expect(redisStore.has('deploybootstrap:AMA')).toBe(false);
});

test('a second replica claiming concurrently backs off without checking', async () => {
	// What the claim is actually for: two replicas booting together must not both read an empty list and both
	// write. The held claim is only ever observed for the length of one bootstrap, not for its TTL.
	const held = fakeApi([]);
	const blocked = fakeApi([]);

	await Promise.all([
		bootstrapGlobalCommands('AMA', '123', held),
		// Claim taken by the first call above; this one is modelled as arriving while it is still held.
		(async () => {
			redisStore.add('deploybootstrap:AMA');
			await bootstrapGlobalCommands('AMA', '123', blocked);
		})(),
	]);

	expect(blocked.getGlobalCommands).not.toHaveBeenCalled();
});

test('the claim is released even when the Discord call throws', async () => {
	const api = {
		getGlobalCommands: vi.fn(async () => {
			throw new Error('503');
		}),
		bulkOverwriteGlobalCommands: vi.fn(async () => undefined),
	};

	await expect(bootstrapGlobalCommands('AMA', '123', api)).rejects.toThrow('503');
	// Otherwise a transient Discord blip would cost the next five minutes of restarts as well as this one.
	expect(redisStore.has('deploybootstrap:AMA')).toBe(false);
});
