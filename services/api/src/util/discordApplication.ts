import { discordAPIModmail } from './discordAPI.js';

let modmailApplicationId: string | undefined;
let pending: Promise<string> | undefined;

/**
 * The ModMail bot's own Discord application id -- required as the first argument to every guild
 * slash-command call (create/edit/delete). Not exposed via env; an application's id never changes,
 * so it's fetched once via the bot token and cached for the life of the process.
 */
export async function getModmailApplicationId(): Promise<string> {
	if (modmailApplicationId) {
		return modmailApplicationId;
	}

	pending ??= (async () => {
		try {
			const application = await discordAPIModmail.applications.getCurrent();
			modmailApplicationId = application.id;
			return application.id;
		} catch (error) {
			// A transient failure (network blip, momentary Discord outage) shouldn't poison every future call for
			// the rest of the process's lifetime -- clear the cached promise so the next call retries fresh.
			pending = undefined;
			throw error;
		}
	})();

	return pending;
}
