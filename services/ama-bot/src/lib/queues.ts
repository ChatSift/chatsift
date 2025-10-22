import type { AMASession } from '@chatsift/backend-core';
import type { Selectable } from 'kysely';

export enum CurrentlyInQueue {
	mod,
	guest,
	answers,
}

interface GetNextQueueResult {
	kind: CurrentlyInQueue;
	queueId: string;
}

export function getNextQueue(currently: CurrentlyInQueue, session: Selectable<AMASession>): GetNextQueueResult | null {
	switch (currently) {
		case CurrentlyInQueue.answers: {
			return null;
		}

		case CurrentlyInQueue.guest: {
			return { kind: CurrentlyInQueue.answers, queueId: session.answersChannelId };
		}

		case CurrentlyInQueue.mod: {
			if (session.guestQueueId) {
				return { kind: CurrentlyInQueue.guest, queueId: session.guestQueueId };
			}

			return { kind: CurrentlyInQueue.answers, queueId: session.answersChannelId };
		}
	}
}
