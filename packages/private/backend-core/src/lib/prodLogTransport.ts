import { once } from 'node:events';
import process from 'node:process';
import { pinoRotateFile } from '@chatsift/pino-rotate-file';
import build from 'pino-abstract-transport';

export interface ProdLogTransportOptions {
	dir: string;
}

/**
 * Single combined pino transport target for production: writes every log line to both stdout (captured by
 * docker's json-file driver, viewed via dozzle) and a day-rotated file on disk (bind-mounted to the host so a
 * server-side CLI can grep/query it -- see issue #208).
 *
 * Deliberately registered as pino's *only* transport target rather than as two separate targets. With 2+
 * targets, pino routes every line through `pino.multistream()`, which decides per-target delivery by parsing
 * the line's `level` field as a number. `createLoggerOptions` formats `level` as a string label instead (dozzle
 * requires that exact shape -- it type-asserts the JSON `level` value as a Go string when guessing severity), so
 * multistream's numeric comparison would silently fail and drop every line for every target. A single target
 * skips that routing layer entirely, so the string level reaches both destinations untouched.
 */
export default async function prodLogTransport(options: ProdLogTransportOptions) {
	const file = await pinoRotateFile({ dir: options.dir, mkdir: true });

	return build(
		async (source: AsyncIterable<Record<string, unknown>>) => {
			for await (const payload of source) {
				const line = `${JSON.stringify(payload)}\n`;

				const stdoutOk = process.stdout.write(line);
				const fileOk = file.write(line);

				await Promise.all([
					stdoutOk ? undefined : once(process.stdout, 'drain'),
					fileOk ? undefined : once(file, 'drain'),
				]);
			}
		},
		{
			close: async () => {
				file.end();
				await once(file, 'close');
			},
		},
	);
}
