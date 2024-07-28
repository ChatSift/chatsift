import { serialize, type CookieSerializeOptions } from 'cookie';
import type { FastifyReply } from 'fastify';

export function appendToHeader(reply: FastifyReply, header: string, value: string[] | number | string): void {
	const prev = reply.getHeader(header);

	let final = value;
	if (prev) {
		final = Array.isArray(prev) ? prev.concat(value as string) : ([prev].concat(value) as string[]);
	}

	void reply.header(header, final);
}

export function appendCookie(reply: FastifyReply, name: string, data: string, options?: CookieSerializeOptions): void {
	const value = serialize(name, data, options);
	// Fastify already behaves like appendToHeader for Set-Cookie
	void reply.header('Set-Cookie', value);
}
