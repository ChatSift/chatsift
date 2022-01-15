import type { APIGuildInteraction } from 'discord-api-types/v9';
import type { Response } from 'polka';

export type Interaction = APIGuildInteraction & { res: Response };
