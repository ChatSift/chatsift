// https://github.com/ChatSift/logs - but modern. Due to quick iteration, it currently lives in this repo.
// In the future, it might be moved to the logs repo.

// Note that this file should never be imported/exported. Pino spawns it as a worker thread.

import { URL } from 'node:url';
import pino from 'pino';
import buildPinoTransport from 'pino-abstract-transport';

/**
 * Options for the transport.
 */
export interface TransportOptions {
	/**
	 * The authorization token to use.
	 */
	auth: string;
	/**
	 * The domain to send logs to.
	 */
	domain: string;
	/**
	 * The stream to send logs to.
	 */
	stream: string;
}

/**
 * Data to log.
 *
 * @internal
 */
export interface LogData extends TransportOptions {
	/**
	 * The literal log data.
	 */
	data: any;
}

export default async function transport(options: TransportOptions) {
	await ensureStream(options);

	return buildPinoTransport(async (source) => {
		for await (const data of source) {
			void handleLog({ ...options, data });
		}
	});
}

function transformLogData(data: any) {
	if ('level' in data && typeof data.level === 'number') {
		data.level = pino.levels.labels[data.level];
	}

	if ('time' in data) {
		delete data.datetime;
	}

	return data;
}

async function handleLog(options: LogData) {
	const body = JSON.stringify(transformLogData(options.data));

	const res = await fetch(new URL('/api/v1/ingest', options.domain), {
		method: 'POST',
		body,
		headers: getHeaders(options),
	});

	if (!res.ok) {
		console.error('Failed to send log', await parseResponseIfPossible(res));
	}
}

function getHeaders({ stream, auth }: TransportOptions): Record<string, string> {
	return {
		'X-P-Stream': stream,
		Authorization: `Basic ${auth}`,
		'Content-Type': 'application/json',
	};
}

async function parseResponseIfPossible(res: Response): Promise<any> {
	async function tryText(): Promise<string | null> {
		try {
			return await res.text();
		} catch {
			return null;
		}
	}

	if (res.headers.get('content-type')?.startsWith('application/json')) {
		try {
			return await res.json();
		} catch {
			return tryText();
		}
	}

	return tryText();
}

async function ensureStream(options: TransportOptions): Promise<void> {
	const { domain, stream } = options;
	const headers = getHeaders(options);

	const streamListResponse = await fetch(new URL('/api/v1/logstream', domain), {
		method: 'GET',
		headers,
	});

	if (!streamListResponse.ok) {
		console.error('body', await parseResponseIfPossible(streamListResponse));
		throw new Error('Failed to get log streams');
	}

	const streamList = (await streamListResponse.json()) as { name: string }[];
	if (!streamList.some(({ name }) => name === stream)) {
		const createResponse = await fetch(new URL(`/api/v1/logstream/${stream}`, domain), {
			method: 'PUT',
			headers,
		});

		if (!createResponse.ok) {
			console.log(await parseResponseIfPossible(createResponse));
			throw new Error('Failed to create log stream');
		}

		// Streams must not be empty before setting up retention
		await handleLog({
			...options,
			data: { msg: 'Log stream created', level: pino.levels.values.info, time: Date.now() },
		});

		const retentionResponse = await fetch(new URL(`/api/v1/logstream/${stream}/retention`, domain), {
			method: 'PUT',
			headers,
			body: JSON.stringify([
				{
					description: 'delete after 30 days',
					duration: '30d',
					action: 'delete',
				},
			]),
		});

		if (!retentionResponse.ok) {
			console.log(await parseResponseIfPossible(retentionResponse));
			throw new Error('Failed to setup log stream retention');
		}
	}
}
