import postgres from 'postgres';

export type Database = postgres.Sql;

/**
 * The handle a `db.begin` callback is given. Structurally *not* a `Database` (it has no `begin`/`END`/
 * connection-level members), so a query helper meant to be callable both standalone and mid-transaction
 * has to accept `Database | DatabaseTransaction` rather than just the former.
 */
export type DatabaseTransaction = postgres.TransactionSql;

// Generated row types (kanel — see docs/adr/0002-db-stack.md), re-exported from the package root so consumers can
// annotate `getContext().db<Row[]>` queries against the real schema instead of hand-duplicating row shapes. Add a
// table's types here the first time a consumer actually needs them — see docs/roadmap/02-foundation.md Part C.
export type { default as AmaPromptData, AmaPromptDataId } from './generated/public/AmaPromptData.js';
export type { default as AmaQuestions, AmaQuestionsId } from './generated/public/AmaQuestions.js';
export type { default as AmaQuestionState } from './generated/public/AmaQuestionState.js';
export type { default as AmaSessions, AmaSessionsId } from './generated/public/AmaSessions.js';
export type { default as AmaQuestionAskers, AmaQuestionAskersId } from './generated/public/AmaQuestionAskers.js';
export type { default as AmaQuestionTags, AmaQuestionTagsId } from './generated/public/AmaQuestionTags.js';
export type { default as AmaQuestionTagAssignments } from './generated/public/AmaQuestionTagAssignments.js';
export type { default as DashboardGrants, DashboardGrantsId } from './generated/public/DashboardGrants.js';
export type { default as GuildSettings, GuildSettingsGuildId } from './generated/public/GuildSettings.js';
export type { default as ModmailInstances, ModmailInstancesId } from './generated/public/ModmailInstances.js';
export type { default as Categories, CategoriesId } from './generated/public/Categories.js';
export type { default as TicketPanels, TicketPanelsId } from './generated/public/TicketPanels.js';
export type { default as TicketPanelCategories } from './generated/public/TicketPanelCategories.js';
export type { default as PendingTickets, PendingTicketsPrivateThreadId } from './generated/public/PendingTickets.js';
export type { default as Threads, ThreadsId } from './generated/public/Threads.js';
export type { default as ThreadMessages, ThreadMessagesId } from './generated/public/ThreadMessages.js';
export type { default as ThreadMessageContent } from './generated/public/ThreadMessageContent.js';
export type {
	default as ThreadMessageContentEdits,
	ThreadMessageContentEditsId,
} from './generated/public/ThreadMessageContentEdits.js';
export type { default as ScheduledThreadCloses } from './generated/public/ScheduledThreadCloses.js';
export type { default as ScheduledThreadNukes } from './generated/public/ScheduledThreadNukes.js';
export type { default as Blocks } from './generated/public/Blocks.js';
export type { default as ThreadOpenAlerts } from './generated/public/ThreadOpenAlerts.js';
export type { default as ThreadReplyAlerts } from './generated/public/ThreadReplyAlerts.js';
export type { default as Snippets, SnippetsId } from './generated/public/Snippets.js';
export type { default as SnippetUpdates, SnippetUpdatesId } from './generated/public/SnippetUpdates.js';
export type {
	default as SocialGuildSettings,
	SocialGuildSettingsGuildId,
} from './generated/public/SocialGuildSettings.js';
export type { default as SocialLevelUpNotificationMode } from './generated/public/SocialLevelUpNotificationMode.js';
export type { default as SocialUsers, SocialUsersGuildId, SocialUsersUserId } from './generated/public/SocialUsers.js';
export type {
	default as SocialChannels,
	SocialChannelsChannelId,
	SocialChannelsGuildId,
} from './generated/public/SocialChannels.js';
export type { default as SocialRoles, SocialRolesGuildId, SocialRolesRoleId } from './generated/public/SocialRoles.js';
export type {
	default as SocialRewards,
	SocialRewardsGuildId,
	SocialRewardsRoleId,
} from './generated/public/SocialRewards.js';
export type { default as SocialInteractions, SocialInteractionsId } from './generated/public/SocialInteractions.js';

export type { default as Experiments, ExperimentsName } from './generated/public/Experiments.js';
export type { default as ExperimentOverrides } from './generated/public/ExperimentOverrides.js';
export type {
	default as AutomoderatorGuildSettings,
	AutomoderatorGuildSettingsGuildId,
} from './generated/public/AutomoderatorGuildSettings.js';
export type { default as AutomoderatorCaseAction } from './generated/public/AutomoderatorCaseAction.js';
export type { default as AutomoderatorCases, AutomoderatorCasesId } from './generated/public/AutomoderatorCases.js';
export type { default as AutomoderatorLogType } from './generated/public/AutomoderatorLogType.js';
export type { default as AutomoderatorLogWebhooks } from './generated/public/AutomoderatorLogWebhooks.js';
export type { default as AutomoderatorReportState } from './generated/public/AutomoderatorReportState.js';
export type { default as AutomoderatorReportOrigin } from './generated/public/AutomoderatorReportOrigin.js';
export type {
	default as AutomoderatorReports,
	AutomoderatorReportsId,
} from './generated/public/AutomoderatorReports.js';
export type {
	default as AutomoderatorReportMessages,
	AutomoderatorReportMessagesId,
} from './generated/public/AutomoderatorReportMessages.js';
export type {
	default as AutomoderatorReporters,
	AutomoderatorReportersReporterId,
} from './generated/public/AutomoderatorReporters.js';
export type {
	default as AutomoderatorReportPresets,
	AutomoderatorReportPresetsId,
} from './generated/public/AutomoderatorReportPresets.js';
export type {
	default as AutomoderatorReportPrompts,
	AutomoderatorReportPromptsId,
} from './generated/public/AutomoderatorReportPrompts.js';
export type { default as AutomoderatorLogExemptions } from './generated/public/AutomoderatorLogExemptions.js';
export type { default as AutomoderatorWarnPunishmentAction } from './generated/public/AutomoderatorWarnPunishmentAction.js';
export type {
	default as AutomoderatorWarnPunishments,
	AutomoderatorWarnPunishmentsGuildId,
	AutomoderatorWarnPunishmentsWarns,
} from './generated/public/AutomoderatorWarnPunishments.js';

export interface CreateDbOptions {
	/**
	 * Passed through to `postgres()`, merged on top of the `postgres.camel` transform default
	 * (see docs/roadmap/02-foundation.md Part A step 2 for the snake_case + camel-transform decision).
	 */
	options?: postgres.Options<Record<string, postgres.PostgresType>>;
	url: string;
}

export function createDb({ url, options }: CreateDbOptions): Database {
	return postgres(url, { transform: postgres.camel, ...options });
}

/**
 * Whether an error is Postgres' 23505 (unique violation), optionally for one named constraint or index.
 *
 * Lives here rather than in a consumer because it is a fact about this package's client -- `postgres.PostgresError`
 * is the only thing that can produce the shape -- and because both `services/api` and the bots need it. Naming the
 * constraint matters when a table has more than one unique key: an unqualified check turns "that name is taken"
 * and "that idempotency key was already used" into the same branch.
 */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
	if (!(error instanceof postgres.PostgresError)) {
		return false;
	}

	return error.code === '23505' && (constraintName === undefined || error.constraint_name === constraintName);
}
