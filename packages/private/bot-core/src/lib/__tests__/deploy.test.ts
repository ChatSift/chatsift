import type { Logger } from '@chatsift/backend-core';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

const { fakeLogger, fakeReply, fakeDefer, fakeEditReply, fakeBulkOverwrite, getAdmins, setAdmins } = vi.hoisted(() => {
	let admins = new Set<string>();

	return {
		fakeLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
		fakeReply: vi.fn(),
		fakeDefer: vi.fn(),
		fakeEditReply: vi.fn(),
		fakeBulkOverwrite: vi.fn(),
		getAdmins: () => admins,
		setAdmins: (next: Set<string>) => {
			admins = next;
		},
	};
});

vi.mock('@chatsift/backend-core', async (importActual) => {
	stubBackendCoreEnv();
	const actual = await importActual<typeof import('@chatsift/backend-core')>();

	return {
		...actual,
		getContext: () => ({
			env: { ADMINS: getAdmins() },
			logger: fakeLogger,
			service: {
				client: {
					api: {
						interactions: { reply: fakeReply, defer: fakeDefer, editReply: fakeEditReply },
						applicationCommands: { bulkOverwriteGlobalCommands: fakeBulkOverwrite },
					},
				},
			},
		}),
	};
});

const { registerCommandHandler } = await import('../commands.js');
const { default: DeployCommand } = await import('../deploy.js');

const logger = fakeLogger as unknown as Logger;

beforeEach(() => {
	vi.clearAllMocks();
	setAdmins(new Set(['admin-1']));
});

function makeInteraction(userId: string | undefined): APIApplicationCommandInteraction {
	return {
		id: 'interaction-1',
		token: 'tok',
		application_id: 'app-1',
		user: userId ? { id: userId } : undefined,
	} as unknown as APIApplicationCommandInteraction;
}

describe('DeployCommand', () => {
	test('rejects non-admin users with an ephemeral reply and never touches the global command set', async () => {
		const command = new DeployCommand();
		await command.handle(makeInteraction('not-an-admin'), logger);

		expect(fakeReply).toHaveBeenCalledWith(
			'interaction-1',
			'tok',
			expect.objectContaining({ content: expect.stringContaining('not authorized'), flags: MessageFlags.Ephemeral }),
		);
		expect(fakeBulkOverwrite).not.toHaveBeenCalled();
	});

	test('rejects interactions with no user', async () => {
		const command = new DeployCommand();
		await command.handle(makeInteraction(undefined), logger);

		expect(fakeReply).toHaveBeenCalled();
		expect(fakeBulkOverwrite).not.toHaveBeenCalled();
	});

	test('an admin triggers a defer, a bulk-overwrite of every registered command, and a success editReply', async () => {
		registerCommandHandler({
			name: 'unit-test-deploy-cmd-a',
			data: { name: 'unit-test-deploy-cmd-a' },
			handle: vi.fn(),
		} as any);
		registerCommandHandler({
			name: 'unit-test-deploy-cmd-b',
			data: { name: 'unit-test-deploy-cmd-b' },
			handle: vi.fn(),
		} as any);

		const command = new DeployCommand();
		const interaction = makeInteraction('admin-1');
		await command.handle(interaction, logger);

		expect(fakeDefer).toHaveBeenCalled();
		expect(fakeBulkOverwrite).toHaveBeenCalledWith('app-1', expect.any(Array));

		const deployedData = fakeBulkOverwrite.mock.calls[0]![1];
		expect(deployedData).toEqual(
			expect.arrayContaining([{ name: 'unit-test-deploy-cmd-a' }, { name: 'unit-test-deploy-cmd-b' }]),
		);
		expect(fakeEditReply).toHaveBeenCalledWith(
			'app-1',
			'tok',
			expect.objectContaining({ content: expect.stringContaining('Deployed') }),
		);
	});

	test('a bulk-overwrite failure logs the error and edits the reply with a failure message instead of throwing', async () => {
		fakeBulkOverwrite.mockRejectedValueOnce(new Error('discord is down'));

		const command = new DeployCommand();
		const interaction = makeInteraction('admin-1');

		await expect(command.handle(interaction, logger)).resolves.toBeUndefined();

		expect(fakeLogger.error).toHaveBeenCalled();
		expect(fakeEditReply).toHaveBeenCalledWith(
			'app-1',
			'tok',
			expect.objectContaining({ content: expect.stringContaining('Failed') }),
		);
	});
});
