import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { calculateTotalRequiredXp, calculateUserLevel } from '@chatsift/core';
import type { SocialGuildSettings, SocialRewards, SocialUsers } from '@chatsift/db';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { sortRoleIdsByHierarchy } from '../lib/discordCache.js';

function mentions(roleIds: readonly string[]): string {
	return roleIds.length > 0 ? roleIds.map((roleId) => `<@&${roleId}>`).join(', ') : 'None';
}

export default class LevelCommand implements CommandHandler {
	public readonly name = 'level';

	public readonly data = new ChatInputCommandBuilder()
		.setName('level')
		.setDescription('Show your level and progress in this server')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.addUserOptions((option) => option.setName('user').setDescription('Whose level to look up').setRequired(false))
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		const reply = async (content: string) => {
			await api.interactions.reply(interaction.id, interaction.token, {
				content,
				flags: MessageFlags.Ephemeral,
			});
		};

		if (!interaction.guild_id) {
			await reply('This command can only be used in a server.');
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const target = options.getUser('user') ?? interaction.member?.user ?? interaction.user;
		if (!target) {
			await reply('Could not work out whose level to look up.');
			return;
		}

		// Deferred once the validation above is out of the way: three queries follow, and while each is an
		// indexed lookup, none of them has to be fast for this to still be the right shape -- a lookup command
		// showing a brief thinking state costs nothing, where blowing the three-second ack window costs the
		// whole response. (Social interactions deliberately don't defer -- see `lib/interactions.ts`.)
		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const editReply = async (content: string) => {
			await api.interactions.editReply(interaction.application_id, interaction.token, { content });
		};

		const db = getContext().db;

		const [settings] = await db<SocialGuildSettings[]>`
			SELECT * FROM social_guild_settings WHERE guild_id = ${interaction.guild_id}
		`;

		// The curve fields are what this command actually needs -- a guild can have a settings row without them
		// (the dashboard writes partial config), and there's no level to show until they're set.
		const requiredXpBase = settings?.requiredXpBase ?? null;
		const requiredXpMultiplier = settings?.requiredXpMultiplier ?? null;
		if (requiredXpBase === null || requiredXpMultiplier === null) {
			await editReply('This server has not been configured yet.');
			return;
		}

		// Read-only. Legacy upserted here, so `/level @someone` created a `social_users` row for a user who had
		// never sent a message; a missing row simply reads as 0 XP.
		const [user] = await db<Pick<SocialUsers, 'xp'>[]>`
			SELECT xp FROM social_users WHERE guild_id = ${interaction.guild_id} AND user_id = ${target.id}
		`;

		const xp = user?.xp ?? 0;

		const level = calculateUserLevel(requiredXpBase, requiredXpMultiplier, xp);
		const reachedAt = calculateTotalRequiredXp(requiredXpBase, requiredXpMultiplier, level);
		const nextAt = calculateTotalRequiredXp(requiredXpBase, requiredXpMultiplier, level + 1);

		// Every reward, not just the ones up to `level + 1`: the next one to look forward to is whatever is
		// closest above the user's level, which may be several levels away.
		const rewards = await db<SocialRewards[]>`
			SELECT * FROM social_rewards WHERE guild_id = ${interaction.guild_id}
		`;

		// Listed in the guild's own role hierarchy rather than the query's order, so a set of rank roles reads
		// top-down the way the member list shows them instead of in an order nobody chose.
		const current = await sortRoleIdsByHierarchy(
			interaction.guild_id,
			rewards.filter((reward) => reward.level <= level).map((reward) => reward.roleId),
		);

		const upcoming = rewards.filter((reward) => reward.level > level);
		const nextLevel = upcoming.length > 0 ? Math.min(...upcoming.map((reward) => reward.level)) : null;
		// Ties (two roles rewarded at the same level) are listed together, in hierarchy order for the same
		// reason as above.
		const next =
			nextLevel === null
				? []
				: await sortRoleIdsByHierarchy(
						interaction.guild_id,
						upcoming.filter((reward) => reward.level === nextLevel).map((reward) => reward.roleId),
					);

		const info = [
			`**Level**: ${level} (${xp} total XP)`,
			`**Progress**: ${xp - reachedAt} / ${nextAt - reachedAt} XP`,
			`**Current rewards**: ${mentions(current)}`,
			// Names the level it's actually at rather than only ever describing the very next level, which read
			// as "None" for every member who wasn't one level short of something.
			nextLevel === null ? '**Next reward**: None' : `**Next reward**: ${mentions(next)} (at level ${nextLevel})`,
		];

		// Role mentions inside an embed description render as names without pinging, so no `allowed_mentions`
		// handling is needed. Ephemeral (inherited from the defer above), matching legacy -- this is a
		// self-service lookup, not an announcement.
		await api.interactions.editReply(interaction.application_id, interaction.token, {
			embeds: [
				{
					author: {
						name: target.global_name ?? target.username,
						...(target.avatar
							? { icon_url: `https://cdn.discordapp.com/avatars/${target.id}/${target.avatar}.png` }
							: {}),
					},
					description: info.map((chunk) => `• ${chunk}`).join('\n'),
					color: 0x58_65_f2,
				},
			],
		});
	}
}
