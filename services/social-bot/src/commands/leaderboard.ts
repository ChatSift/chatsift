import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { calculateUserLevel } from '@chatsift/core';
import type { SocialGuildSettings, SocialUsers } from '@chatsift/db';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';

const PAGE_SIZE = 10;

/**
 * The in-Discord half of the leaderboard (redesign ledger item 5). Legacy had no such command at all --
 * `/level` was the only read surface anyone had, and it can only ever describe one person.
 */
export default class LeaderboardCommand implements CommandHandler {
	public readonly name = 'leaderboard';

	public readonly data = new ChatInputCommandBuilder()
		.setName('leaderboard')
		.setDescription("Show this server's XP leaderboard")
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.addIntegerOptions((option) =>
			option.setName('page').setDescription('Which page of the ranking to show').setMinValue(1).setRequired(false),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		if (!interaction.guild_id) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
			});
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const page = options.getInteger('page') ?? 1;

		// Public, unlike `/level` -- a ranking is something people post at each other, and an ephemeral one
		// can't be. Nobody is pinged regardless; see `allowed_mentions` below.
		await api.interactions.defer(interaction.id, interaction.token);

		const db = getContext().db;

		const [settings] = await db<
			Pick<SocialGuildSettings, 'publicLeaderboard' | 'requiredXpBase' | 'requiredXpMultiplier'>[]
		>`
			SELECT public_leaderboard, required_xp_base, required_xp_multiplier
			FROM social_guild_settings WHERE guild_id = ${interaction.guild_id}
		`;

		// Must stay in step with `services/api`'s `routes/social/leaderboard/util.ts` -- same filter, same
		// order, same `xp > 0` exclusion of rows nobody ever earned in (see that file for why they exist).
		// Two surfaces disagreeing about who is rank 1 would be worse than either being wrong on its own.
		const rows = await db<(Pick<SocialUsers, 'userId' | 'xp'> & { total: number })[]>`
			SELECT user_id, xp, COUNT(*) OVER ()::int AS total
			FROM social_users
			WHERE guild_id = ${interaction.guild_id} AND NOT ignored AND xp > 0
			ORDER BY xp DESC, user_id ASC
			LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
		`;

		const editReply = async (content: string) => {
			await api.interactions.editReply(interaction.application_id, interaction.token, { content });
		};

		if (rows.length === 0) {
			await editReply(page === 1 ? 'Nobody has earned any XP in this server yet.' : 'There is no such page.');
			return;
		}

		const total = rows[0]!.total;
		const pageCount = Math.ceil(total / PAGE_SIZE);
		const { requiredXpBase, requiredXpMultiplier } = settings ?? { requiredXpBase: null, requiredXpMultiplier: null };
		const hasCurve = requiredXpBase !== null && requiredXpMultiplier !== null;

		const lines = rows.map((row, index) => {
			const rank = (page - 1) * PAGE_SIZE + index + 1;
			// A mention rather than a resolved username: Discord renders it as the member's current nickname
			// on the client, which costs no `GET /users/{id}` at all and can't go stale. This bot has no
			// member cache and no `GuildMembers` intent to build one with (see P3's intent audit), so
			// resolving ten names per invocation would otherwise be ten calls into a 30-per-30s bucket.
			const who = `<@${row.userId}>`;
			const xp = `${row.xp.toLocaleString('en-US')} XP`;

			return hasCurve
				? `\`#${rank}\` ${who} — Level ${calculateUserLevel(requiredXpBase, requiredXpMultiplier, row.xp)} · ${xp}`
				: `\`#${rank}\` ${who} — ${xp}`;
		});

		// Only when the guild has actually opted in -- linking a page that 404s would be worse than no link.
		// A masked link in the description rather than the embed's own `url`, which only makes the title
		// clickable and reads as decoration nobody notices.
		const publicUrl = settings?.publicLeaderboard
			? `${getContext().FRONTEND_URL.replace(/\/$/, '')}/leaderboard/${interaction.guild_id}`
			: null;

		await api.interactions.editReply(interaction.application_id, interaction.token, {
			embeds: [
				{
					title: 'Leaderboard',
					description: publicUrl ? `${lines.join('\n')}\n\n[See the full leaderboard](${publicUrl})` : lines.join('\n'),
					color: 0x58_65_f2,
					footer: { text: `Page ${page} of ${pageCount}` },
				},
			],
			// The description is nothing but user mentions. Without this, every listed member is pinged by
			// whoever ran the command -- the one way a leaderboard could become genuinely unwelcome.
			allowed_mentions: { parse: [] },
		});
	}
}
