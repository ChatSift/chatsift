import { APIGuildInteraction } from 'discord-api-types/v8';
import type { Response } from 'polka';

export type Interaction = APIGuildInteraction & { res: Response };
