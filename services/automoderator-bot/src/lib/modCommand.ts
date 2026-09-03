import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction } from '@chatsift/db';
import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandInteraction,
	APIUser,
} from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { ACTION_PAST_TENSE } from './caseFormat.js';
import { formatCaseRef } from './caseLog.js';
import { actorFromUser, getCaseByNumber } from './cases.js';
import type { ModerationResult } from './moderation.js';
import { CaseFilingError, LadderFailureError, SoftbanUnbanError, applyModerationAction } from './moderation.js';
import { checkActorHierarchy, checkBotHierarchy } from './permissions.js';

export type ModCommandExtra = string | { deleteMessageSeconds?: number; durationMs?: number };

export interface ModCommandSpec {
	readonly action: AutomoderatorCaseAction;
	/**
	 * Runs *after* guards
	 */
	extra?(options: ChatInputInteractionOptionResolver): ModCommandExtra;
	/**
	 * Whether to DM the target. On by default; off for the undo actions.
	 */
	readonly notifyTarget?: boolean;
	/**
	 * Whether the target has to still be in the guild.
	 */
	readonly requiresMember?: boolean;
}

export async function runModCommand(
	interaction: APIApplicationCommandInteraction,
	logger: Logger,
	spec: ModCommandSpec,
): Promise<void> {
	const api = getContext().service.client.api;

	const reply = async (content: string) => {
		await api.interactions.editReply(interaction.application_id, interaction.token, { content });
	};

	if (!interaction.guild_id || !interaction.member) {
		await api.interactions.reply(interaction.id, interaction.token, {
			content: 'This command can only be used in a server.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

	try {
		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const targetUser = options.getUser('user', true) as APIUser;
		const reason = options.getString('reason') ?? null;
		const refId = options.getInteger('reference') ?? null;

		// Null when they aren't in the guild, which is how "this person isn't here" is detected -- no REST call
		// either way, since a USER option always carries the resolved member alongside the user.
		const targetMember = options.getMember('user') ?? null;

		if (spec.requiresMember !== false && !targetMember) {
			await reply('That user is not in this server.');
			return;
		}

		const guild = await api.guilds.get(interaction.guild_id);

		const actorVerdict = checkActorHierarchy({
			actor: interaction.member,
			guild,
			target: targetMember,
			targetId: targetUser.id,
		});

		if (!actorVerdict.ok) {
			await reply(actorVerdict.reason);
			return;
		}

		const botVerdict = await checkBotHierarchy(guild, targetMember);
		if (!botVerdict.ok) {
			await reply(botVerdict.reason);
			return;
		}

		const extra = spec.extra?.(options) ?? {};
		if (typeof extra === 'string') {
			await reply(extra);
			return;
		}

		if (refId !== null && !(await getCaseByNumber(interaction.guild_id, refId))) {
			await reply(`There is no case #${refId} in this server.`);
			return;
		}

		const result = await applyModerationAction(
			{
				action: spec.action,
				guildId: interaction.guild_id,
				target: actorFromUser(targetUser),
				mod: actorFromUser(interaction.member.user),
				reason,
				refId,
				...(spec.notifyTarget === undefined ? {} : { notifyTarget: spec.notifyTarget }),
				...extra,
			},
			logger,
		);

		await reply(await describeModerationResult(result, targetUser.username, spec.action));
	} catch (error) {
		logger.error({ err: error, action: spec.action }, 'a mod command failed');
		await reply(await describeCommandFailure(error));
	}
}

/**
 * What the moderator is told. Shared with the report card's action flow so the ladder sentence can't drift
 * between the two places a warn can be issued from.
 */
export async function describeModerationResult(
	result: ModerationResult,
	targetName: string,
	action: AutomoderatorCaseAction,
): Promise<string> {
	const verb = ACTION_PAST_TENSE[action];
	// Async only for this: the case number is a link to the case's own mod-log message wherever there is one to
	// jump to, which needs the mod log's channel looked up (#381).
	const ref = await formatCaseRef(result.case);
	const head = result.suppressed
		? `**Dry run** — would have ${verb} ${targetName}. (case ${ref})`
		: `Successfully ${verb} ${targetName}. (case ${ref})`;

	if (!result.ladder) {
		return head;
	}

	// Said out loud rather than left to the mod log: a `/warn` that also banned somebody is the surprise an
	// escalation ladder is most likely to produce, and the moderator who triggered it is the one person who
	// should never be surprised by it. Keyed off the *ladder's* own suppression rather than the warn's, so the
	// two halves of one message can't disagree about whether anything happened.
	const ladderVerb = ACTION_PAST_TENSE[result.ladder.case.actionType as AutomoderatorCaseAction];
	const ladderClause = result.ladder.suppressed
		? `they would also have been ${ladderVerb}`
		: `they were also ${ladderVerb}`;

	return `${head}\nThat reached a warn ladder step, so ${ladderClause}. (case ${await formatCaseRef(
		result.ladder.case,
	)})`;
}

/**
 * Turns a failed moderation attempt into something a moderator can act on. Shared with the report card's action
 * flow, which can fail in exactly the same ways -- the distinction between "nothing happened" and "it
 * happened but isn't recorded" is the whole point, and it must not be worded twice.
 */
export async function describeCommandFailure(error: unknown): Promise<string> {
	if (error instanceof LadderFailureError) {
		return (
			`The warn was recorded (case ${await formatCaseRef(error.warnCase)}), but it reached a warn ladder ` +
			`step at ${error.warns} warnings and that punishment failed. Apply it by hand, or check my permissions.`
		);
	}

	if (error instanceof SoftbanUnbanError) {
		return (
			'I banned them and deleted their messages, but then failed to lift the ban — **they are still banned**. ' +
			'Unban them manually, or run `/unban`.'
		);
	}

	if (error instanceof CaseFilingError) {
		return error.enforced
			? 'The action went through, but I could not record a case for it.'
			: 'I could not record a case for that, so nothing was done. Try again in a moment.';
	}

	if (error instanceof DiscordAPIError) {
		return `Discord refused that (${error.message}). Check that I have the permission for this action and that my role is above the target.`;
	}

	return 'That failed on our side, and the action may not have been carried out. The error has been logged.';
}
