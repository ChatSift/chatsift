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
		const application = await discordAPIModmail.applications.getCurrent();
		modmailApplicationId = application.id;
		return application.id;
	})();

	return pending;
}
