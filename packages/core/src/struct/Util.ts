import { Buffer } from 'node:buffer';
import { API } from '@discordjs/core';
import { encode as msgpackEncode, decode as msgpackDecode, ExtensionCodec } from '@msgpack/msgpack';
import { Result } from '@sapphire/result';
import type { APIUser } from 'discord-api-types/v10';
import { inject, injectable } from 'inversify';

export enum DMUserFailableSteps {
	MemberCheck,
	ChannelCreation,
	Message,
}

export interface DMUserError {
	exception?: unknown;
	step: DMUserFailableSteps;
}

export type DMUserResult = Result<void, DMUserError>;

@injectable()
export class Util {
	private readonly codec: ExtensionCodec;

	@inject(API)
	private readonly api!: API;

	public constructor() {
		this.codec = new ExtensionCodec();
		this.codec.register({
			type: 0,
			encode: (input: unknown) => {
				if (typeof input === 'bigint') {
					return msgpackEncode(input.toString());
				}

				return null;
			},
			decode: (data: Uint8Array) => BigInt(msgpackDecode(data) as string),
		});
	}

	public async dmUser(userId: string, content: string, guildId?: string): Promise<DMUserResult> {
		if (guildId) {
			const member = await this.api.guilds.getMember(guildId, userId).catch(() => null);
			if (!member) {
				return Result.err<DMUserError>({ step: DMUserFailableSteps.MemberCheck });
			}
		}

		const dmChannelResult = await Result.fromAsync(async () => {
			return this.api.users.createDM(userId);
		});

		if (dmChannelResult.isErr()) {
			return dmChannelResult.mapErr(this.wrapDmUserException(DMUserFailableSteps.ChannelCreation));
		}

		const result = await Result.fromAsync(async () => {
			await this.api.channels.createMessage(dmChannelResult.unwrap().id, { content });
		});

		return result.mapErr(this.wrapDmUserException(DMUserFailableSteps.Message));
	}

	public encodeData(data: unknown): Buffer {
		const encoded = msgpackEncode(data, { extensionCodec: this.codec });
		return Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
	}

	public decodeData(data: Buffer): unknown {
		return msgpackDecode(data, { extensionCodec: this.codec });
	}

	public getUserAvatarURL(user?: APIUser | null) {
		if (!user) {
			return;
		}

		return user.avatar
			? this.api.rest.cdn.avatar(user.id, user.avatar, { extension: 'webp' })
			: this.api.rest.cdn.defaultAvatar(Number.parseInt(user.discriminator, 10) % 5);
	}

	private wrapDmUserException(step: DMUserFailableSteps) {
		return (exception: unknown): DMUserError => {
			return {
				step,
				exception,
			};
		};
	}
}
