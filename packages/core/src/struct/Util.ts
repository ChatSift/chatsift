import { API } from '@discordjs/core';
import type { APIGuildMember, APIUser } from 'discord-api-types/v10';
import { inject, injectable } from 'inversify';

@injectable()
export class Util {
	@inject(API)
	private readonly api!: API;

	public async getNonManagedMemberRoles(guildId: string, member: APIGuildMember): Promise<string[]> {
		const guildRoles = await this.api.guilds.getRoles(guildId);

		const memberRoles = member.roles;
		const nonManagedRoles: string[] = [];

		for (const roleId of memberRoles) {
			const role = guildRoles.find((role) => role.id === roleId);
			if (role && !role.managed) {
				nonManagedRoles.push(roleId);
			}
		}

		return nonManagedRoles;
	}

	public async tryDmUser(userId: string, content: string, guildId?: string): Promise<boolean> {
		if (guildId) {
			const member = await this.api.guilds.getMember(guildId, userId).catch(() => null);
			if (!member) {
				return false;
			}
		}

		const dmChannel = await this.api.users.createDM(userId).catch(() => null);
		if (!dmChannel) {
			return false;
		}

		const message = await this.api.channels.createMessage(dmChannel.id, { content }).catch(() => null);
		return Boolean(message);
	}

	public getUserTag(user?: APIUser | null): string {
		if (!user) {
			return '[Deleted User]';
		}

		return `${user.username}#${user.discriminator}`;
	}

	public getUserAvatarURL(user?: APIUser | null): string | undefined {
		if (!user) {
			return;
		}

		return user.avatar
			? this.api.rest.cdn.avatar(user.id, user.avatar, { extension: 'webp' })
			: this.api.rest.cdn.defaultAvatar(Number.parseInt(user.discriminator, 10) % 5);
	}
}
