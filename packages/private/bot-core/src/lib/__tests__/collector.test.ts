import type { APIModalSubmitInteraction } from '@discordjs/core';
import { InteractionType } from '@discordjs/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

type Listener = (payload: { data: unknown }) => void;

const { getFakeClient, resetFakeClient } = vi.hoisted(() => {
	let listeners = new Set<Listener>();

	return {
		getFakeClient: () => ({
			on: (_event: string, listener: Listener) => {
				listeners.add(listener);
			},
			off: (_event: string, listener: Listener) => {
				listeners.delete(listener);
			},
			emit: (payload: { data: unknown }) => {
				for (const listener of listeners) {
					listener(payload);
				}
			},
			listenerCount: () => listeners.size,
		}),
		resetFakeClient: () => {
			listeners = new Set();
		},
	};
});

vi.mock('@chatsift/backend-core', async (importActual) => {
	stubBackendCoreEnv();
	const actual = await importActual<typeof import('@chatsift/backend-core')>();

	return {
		...actual,
		getContext: () => ({ service: { client: getFakeClient() } }),
	};
});

const { collectModal } = await import('../collector.js');

beforeEach(() => {
	resetFakeClient();
});

describe('collectModal', () => {
	test('resolves with the matching modal submit interaction and detaches its listener', async () => {
		const client = getFakeClient();
		const promise = collectModal('modal-id-1', 5_000);
		expect(client.listenerCount()).toBe(1);

		const interaction = {
			type: InteractionType.ModalSubmit,
			data: { custom_id: 'modal-id-1' },
		} as unknown as APIModalSubmitInteraction;

		client.emit({ data: interaction });

		await expect(promise).resolves.toBe(interaction);
		expect(client.listenerCount()).toBe(0);
	});

	test('ignores interactions with a different custom_id and eventually times out', async () => {
		const client = getFakeClient();
		const promise = collectModal('modal-id-2', 20);

		client.emit({
			data: { type: InteractionType.ModalSubmit, data: { custom_id: 'some-other-id' } },
		});

		await expect(promise).rejects.toThrow('Modal submission timed out');
		expect(client.listenerCount()).toBe(0);
	});

	test('rejects and detaches its listener after the timeout elapses with no matching submission', async () => {
		const client = getFakeClient();
		await expect(collectModal('modal-id-3', 10)).rejects.toThrow('Modal submission timed out');
		expect(client.listenerCount()).toBe(0);
	});
});
