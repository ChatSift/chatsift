import type { APIInteraction } from '@discordjs/core';

export abstract class ICommandHandler {
	public abstract handle(interaction: APIInteraction): Promise<void>;
}
