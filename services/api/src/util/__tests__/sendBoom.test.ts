import { badRequest, notFound } from '@hapi/boom';
import type { Response } from 'polka';
import { expect, test, vi } from 'vitest';
import { sendBoom } from '../sendBoom.js';

function createMockResponse(): Response {
	return {
		statusCode: 0,
		setHeader: vi.fn(),
		end: vi.fn(),
	} as unknown as Response;
}

test('capitalizes the first letter of a lowercase message', () => {
	const res = createMockResponse();
	sendBoom(badRequest('the bot is missing permissions to post in the selected prompt channel'), res);

	const payload = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string) as { message: string };
	expect(payload.message).toBe('The bot is missing permissions to post in the selected prompt channel');
});

test('leaves an already-capitalized message untouched', () => {
	const res = createMockResponse();
	sendBoom(badRequest('Already capitalized'), res);

	const payload = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string) as { message: string };
	expect(payload.message).toBe('Already capitalized');
});

test('does not throw when a Boom error has no custom message', () => {
	const res = createMockResponse();
	sendBoom(notFound(), res);

	const payload = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string) as { message: string };
	expect(payload.message).toBe('Not Found');
});
