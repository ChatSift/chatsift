import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { featureInvocations } from './metrics.js';

const FEATURE = 'legacy_role_prompt';

/**
 * Legacy self-assignable role prompts (#385). Feature 36 is one of the ten dropped by the port, and P9
 * migrates none of its data -- but the prompt *messages* aren't ours to drain: they sit in guild channels
 * with their buttons baked in, and P9 reuses the legacy application's token, so every click keeps arriving
 * here indefinitely. Without this the interaction dies at "No handler found" and the member sees Discord's
 * "This interaction failed", which reads as the bot being broken rather than the feature being gone.
 *
 * The custom_ids come from `services/interactions/src/commands/config/roles.ts` on `origin/v2`:
 * `roles-manage-prompt` (the "Manage your roles" button), `roles-manage-simple|<roleId>` (one button per
 * role, on button-style prompts) and `roles-manage|<promptId>|<index>` (the select menu, which only ever
 * lived in an ephemeral follow-up and so should not outlive the old bot -- covered anyway because it costs a
 * line). None of them use the `name:state` shape `handleComponentInteraction` splits on, which is why this
 * goes through `registerUnknownComponentResolver` rather than being three component handlers.
 */
const LEGACY_ROLE_COMPONENT_NAMES = new Set(['roles-manage-prompt', 'roles-manage-simple', 'roles-manage']);

/**
 * Points at Discord's own feature rather than at anything of ours, because there is no replacement on our
 * side to point at. Onboarding is where an admin configures it; "Channels & Roles" is what the member
 * clicking this button would go looking for.
 */
const NOTICE =
	"AutoModerator's self-assignable roles are gone, so this prompt no longer does anything. Discord has this built in now: please let a server admin know they can set the same roles up under Server Settings > Onboarding, which members pick from in the Channels & Roles screen. They can delete this message once they have.";

export function isLegacyRolePromptCustomId(customId: string): boolean {
	const [name] = customId.split('|') as [string];
	return LEGACY_ROLE_COMPONENT_NAMES.has(name);
}

export async function resolveLegacyRolePrompt(
	interaction: APIMessageComponentInteraction,
	logger: Logger,
): Promise<boolean> {
	if (!isLegacyRolePromptCustomId(interaction.data.custom_id)) {
		return false;
	}

	try {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: NOTICE,
			flags: MessageFlags.Ephemeral,
		});
		featureInvocations.inc({ feature: FEATURE, outcome: 'applied' });
	} catch (error) {
		featureInvocations.inc({ feature: FEATURE, outcome: 'failed' });
		logger.error(
			{ err: error, guildId: interaction.guild_id, customId: interaction.data.custom_id },
			'failed to answer a legacy self-assignable role prompt',
		);
	}

	// Claimed either way. A failed reply is still this resolver's interaction, and falling through would log
	// it as an unrecognised component -- the one line that would otherwise tell us a new id had appeared.
	return true;
}
