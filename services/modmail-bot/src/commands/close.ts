import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { closeThread } from '../lib/threadClose.js';
import { findOpenThreadByModThreadId } from '../lib/threads.js';

export default class CloseCommand implements CommandHandler {
	public readonly name = 'close';

	public readonly data = new ChatInputCommandBuilder()
		.setName('close')
		.setDescription('Close this ModMail ticket')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.addSubcommands(
			(subcommand) =>
				subcommand
					.setName('now')
					.setDescription('Close this ticket immediately')
					.addBooleanOptions((option) =>
						option
							.setName('silent')
							.setDescription("Skip the farewell message to the user - doesn't affect the mod-forum log")
							.setRequired(false),
					)
					.addBooleanOptions((option) =>
						option.setName('anon').setDescription('Send the farewell message anonymously').setRequired(false),
					),
			(subcommand) =>
				subcommand
					.setName('schedule')
					.setDescription('Schedule this ticket to close after a delay')
					.addIntegerOptions((option) =>
						option
							.setName('minutes')
							.setDescription('Delay, in minutes, before the ticket closes')
							.setRequired(true)
							.setMinValue(1),
					)
					.addBooleanOptions((option) =>
						option
							.setName('silent')
							.setDescription("Skip the farewell message to the user - doesn't affect the mod-forum log")
							.setRequired(false),
					)
					.addBooleanOptions((option) =>
						option.setName('anon').setDescription('Send the farewell message anonymously').setRequired(false),
					),
			(subcommand) => subcommand.setName('cancel').setDescription('Cancel a pending scheduled close for this ticket'),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
		if (!interaction.guild_id || !interaction.channel || !interaction.member) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const thread = await findOpenThreadByModThreadId(interaction.channel.id);
		if (!thread) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used inside an open ModMail ticket thread.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const subcommand = options.getSubcommand(true);
		const staffId = interaction.member.user.id;

		const reply = async (content: string, { ephemeral = true }: { ephemeral?: boolean } = {}) => {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content,
				...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
			});
		};

		switch (subcommand) {
			case 'now': {
				const silent = options.getBoolean('silent') ?? false;
				const anon = options.getBoolean('anon') ?? false;

				// Replied *before* closing rather than after: `closeThread` archives + locks the mod-forum
				// thread as one of its last steps, and Discord rejects creating a new interaction response
				// in a channel that's already archived (`DiscordAPIError` 50083) — replying first means the
				// response exists before that happens. `editReply` afterwards (not another `reply`) edits
				// that same already-sent response rather than trying to send a second one.
				await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
					flags: MessageFlags.Ephemeral,
				});
				// `false` means the thread was already closed by the time this ran (e.g. a scheduled close
				// firing in the same instant) — nothing left for this call to do, so say so rather than
				// implying this command was what closed it.
				const closed = await closeThread({ anon, closedById: staffId, logger, silent, thread });
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: closed ? '✅ Ticket closed.' : 'This ticket was already closed.',
				});
				break;
			}

			case 'schedule': {
				const minutes = options.getInteger('minutes', true);
				const silent = options.getBoolean('silent') ?? false;
				const anon = options.getBoolean('anon') ?? false;
				const closeAt = new Date(Date.now() + minutes * 60_000);

				await getContext().db`
					INSERT INTO scheduled_thread_closes (thread_id, scheduled_by_id, silent, anon, close_at)
					VALUES (${thread.id}, ${staffId}, ${silent}, ${anon}, ${closeAt})
					ON CONFLICT (thread_id) DO UPDATE SET scheduled_by_id = EXCLUDED.scheduled_by_id, silent = EXCLUDED.silent, anon = EXCLUDED.anon, close_at = EXCLUDED.close_at
				`;

				// Public, not ephemeral — other staff working this ticket should see it's about to close
				// (and who scheduled it) without having to check `/close cancel` or ask around.
				await reply(`✅ This ticket will close <t:${Math.floor(closeAt.getTime() / 1_000)}:R>.`, {
					ephemeral: false,
				});
				break;
			}

			case 'cancel': {
				const [cancelled] = await getContext().db<[{ threadId: number }?]>`
					DELETE FROM scheduled_thread_closes WHERE thread_id = ${thread.id} RETURNING thread_id
				`;

				if (cancelled) {
					// Same reasoning as the schedule confirmation above — public so it's visible that the
					// pending close no longer applies.
					await reply('✅ Scheduled close cancelled.', { ephemeral: false });
				} else {
					await reply('This ticket has no scheduled close to cancel.');
				}

				break;
			}

			default: {
				await reply('Unknown subcommand.');
			}
		}
	}
}
