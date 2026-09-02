import type { IncomingMessage, ServerResponse } from 'node:http';
import { Registry } from 'prom-client';
import { expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

stubBackendCoreEnv();

const { createMetricsHandler } = await import('../metricsServer.js');

const SECRET = 'so secret three';

function makeRes() {
	const res = {
		writeHead: vi.fn(() => res),
		end: vi.fn(() => res),
	};

	return res as unknown as ServerResponse & typeof res;
}

function makeReq(url: string, authorization?: string): IncomingMessage {
	return { url, headers: authorization === undefined ? {} : { authorization } } as unknown as IncomingMessage;
}

async function call(url: string, authorization?: string) {
	const register = new Registry();
	const res = makeRes();

	await createMetricsHandler(register)(makeReq(url, authorization), res);

	return res;
}

test('serves the exposition body for an authorized scrape', async () => {
	const res = await call('/metrics', `Bearer ${SECRET}`);

	expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': expect.any(String) }));
	expect(res.end).toHaveBeenCalledWith(expect.any(String));
});

// Every one of these is a *silent* misconfiguration if it were to pass -- Prometheus reports the target as down
// either way, so the only thing that distinguishes "wrong token" from "wrong path" is this behaviour.
test.each([
	['no header at all', undefined],
	['the raw secret without the Bearer prefix', SECRET],
	['a wrong token of the same length', 'Bearer so secret threX'],
	['a wrong token of a different length', 'Bearer nope'],
	['an empty bearer token', 'Bearer '],
])('rejects %s with 401', async (_label, authorization) => {
	const res = await call('/metrics', authorization);

	expect(res.writeHead).toHaveBeenCalledWith(401);
});

test('404s any path that is not /metrics, before checking the token', async () => {
	const res = await call('/', `Bearer ${SECRET}`);

	expect(res.writeHead).toHaveBeenCalledWith(404);
});
