import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { fakeDb, fakeLogger, envState } = vi.hoisted(() => ({
	fakeDb: vi.fn(),
	fakeLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
	envState: { MODMAIL_INSTANCE_ID: undefined as string | undefined },
}));

vi.mock('../context.js', () => ({
	getContext: () => ({ db: fakeDb, logger: fakeLogger, env: envState }),
}));

// `decryptSecret` is exercised on its own in secret.test.ts -- here a row's `token` column is already
// "encrypted" as `enc:<plaintext>` so the round trip stays a plain string comparison.
vi.mock('../secret.js', () => ({
	decryptSecret: (value: string) => value.replace(/^enc:/, ''),
}));

function row(overrides: Partial<{ guildId: string; id: string; label: string; token: string }> = {}) {
	return {
		id: 'partner-a',
		guildId: 'partner-guild',
		label: 'Partner A',
		token: 'enc:real-token',
		createdAt: new Date(),
		...overrides,
	};
}

// `../instances.js` keeps its snapshot in module-level state with no reset API (there's no legitimate
// production reason to expose one -- it's loaded once at boot). `resetModules` + a fresh dynamic import
// per test is what gives each test its own clean slate instead of leaking a previous test's resolved
// `selfInstance` forward.
async function freshInstances() {
	vi.resetModules();
	return import('../instances.js');
}

beforeEach(() => {
	envState.MODMAIL_INSTANCE_ID = undefined;
});

afterEach(() => {
	vi.clearAllMocks();
});

test('loadInstances populates getInstanceForGuild/getCustomInstanceGuildIds from the DB, decrypting each token', async () => {
	const { getCustomInstanceGuildIds, getInstanceForGuild, loadInstances } = await freshInstances();
	fakeDb.mockResolvedValue([row()]);

	await loadInstances();

	expect(getInstanceForGuild('partner-guild')).toEqual({
		id: 'partner-a',
		guildId: 'partner-guild',
		label: 'Partner A',
		token: 'real-token',
	});
	expect(getInstanceForGuild('some-other-guild')).toBeNull();
	expect(getCustomInstanceGuildIds()).toEqual(new Set(['partner-guild']));
});

test('getSelfInstance stays null when MODMAIL_INSTANCE_ID is unset', async () => {
	const { getSelfInstance, loadInstances } = await freshInstances();
	fakeDb.mockResolvedValue([row()]);

	await loadInstances();

	expect(getSelfInstance()).toBeNull();
});

test('getSelfInstance resolves the row matching MODMAIL_INSTANCE_ID', async () => {
	envState.MODMAIL_INSTANCE_ID = 'partner-a';
	const { getSelfInstance, loadInstances } = await freshInstances();
	fakeDb.mockResolvedValue([row(), row({ id: 'partner-b', guildId: 'other-guild', label: 'Partner B' })]);

	await loadInstances();

	expect(getSelfInstance()).toMatchObject({ id: 'partner-a', guildId: 'partner-guild' });
});

test('loadInstances throws when MODMAIL_INSTANCE_ID matches no row', async () => {
	envState.MODMAIL_INSTANCE_ID = 'does-not-exist';
	const { loadInstances } = await freshInstances();
	fakeDb.mockResolvedValue([row()]);

	await expect(loadInstances()).rejects.toThrow(/does-not-exist/);
});
