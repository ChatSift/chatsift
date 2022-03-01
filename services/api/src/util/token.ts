// A token is structured as {app_id}.{sig}
// Where both of these things are base64 encoded and
// The sig is in plain text.

// A sig is 32 random bytes. It is kept as a bcrypt hash in the database

// On authorizing a request, one should break down the token, use the app_id to gather all the sigs available
// And check if any of them matches the provided one

// Unused sigs are automatically expired after a week.

import { App, PrismaClient } from '@prisma/client';
import { compare, hash } from 'bcrypt';
import { randomBytes } from 'crypto';
import { singleton } from 'tsyringe';

export const enum TokenValidationStatus {
	malformedToken,
	malformedAppId,
	noMatch,
	success,
}

export interface TokenValidationResult {
	status: TokenValidationStatus;
	app?: App;
}

@singleton()
export class TokenManager {
	public constructor(public readonly prisma: PrismaClient) {}

	public async generate(id: number): Promise<string> {
		const idChunk = Buffer.from(id.toString()).toString('base64');
		const token = randomBytes(32).toString('base64');

		await this.prisma.sig.create({
			data: {
				appId: id,
				sig: await hash(token, 10),
			},
		});

		return `${idChunk}.${token}`;
	}

	public async validate(token: string): Promise<TokenValidationResult> {
		const meta = token.split('.');
		if (meta.length !== 2) {
			return { status: TokenValidationStatus.malformedToken };
		}

		const [idRaw, sigRaw] = meta as [string, string];
		const id = parseInt(Buffer.from(idRaw, 'base64').toString('utf8'), 10);

		if (isNaN(id)) {
			return { status: TokenValidationStatus.malformedAppId };
		}

		const app = await this.prisma.app.findFirst({
			where: {
				appId: id,
			},
			include: {
				sigs: true,
			},
		});

		if (!app) {
			return { status: TokenValidationStatus.noMatch };
		}

		let match: string | null = null;
		for (const { sig } of app.sigs) {
			if (await compare(sigRaw, sig)) {
				match = sig;
				break;
			}
		}

		if (!match) {
			return { status: TokenValidationStatus.noMatch };
		}

		await this.prisma.sig.update({
			data: {
				lastUsedAt: new Date(),
			},
			where: {
				sig: match,
			},
		});

		return { status: TokenValidationStatus.success, app };
	}
}
