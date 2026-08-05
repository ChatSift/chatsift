// One-off script: DM the ModMail migration announcement to guild owners.
// Message is built with Discord Components V2 (IS_COMPONENTS_V2 flag) rather
// than a legacy embed.
//
// Usage:
//   MODMAIL_ANNOUNCE_TOKEN=<bot token> MIGRATION_START_ISO=<ISO datetime, UTC> \
//     node announce-modmail-migration.mjs --test
//   MODMAIL_ANNOUNCE_TOKEN=<bot token> MIGRATION_START_ISO=<ISO datetime, UTC> \
//     node announce-modmail-migration.mjs --live
//
// MIGRATION_START_ISO is the exact UTC start of the 48h thread-freeze window,
// e.g. "2026-09-01T17:00:00Z". Required for --live. For --test it defaults to
// 7 days from now (clearly a placeholder) if omitted, so a test send doesn't
// need the real date decided yet.
//
// --test sends ONLY to the hardcoded TEST_RECIPIENT below (fake "ChatSift" guild).
// --live sends to every entry in OWNERS. One of the two flags is required — there
// is no default — so a bare invocation can't accidentally blast real owners.
//
// Uses plain Discord REST calls (POST /users/@me/channels, POST /channels/:id/messages)
// via the token's bot identity. No gateway connection needed for a DM send.

import process from 'node:process';
import { setTimeout } from 'node:timers/promises';

const token = process.env.MODMAIL_ANNOUNCE_TOKEN;
if (!token) {
	console.error('MODMAIL_ANNOUNCE_TOKEN env var is required');
	process.exit(1);
}

const mode = process.argv.includes('--live') ? 'live' : process.argv.includes('--test') ? 'test' : null;
if (!mode) {
	console.error('Pass --test (fake single recipient) or --live (real owner list)');
	process.exit(1);
}

let migrationStart;
if (process.env.MIGRATION_START_ISO) {
	const raw = process.env.MIGRATION_START_ISO;

	// The <t:...> Discord timestamp markup below is computed from `migrationStart.getTime()`, which is
	// only correct if the input is unambiguously UTC -- an offset-less "local" ISO string (e.g.
	// "2026-09-01T17:00:00") gets parsed as the *runner's* local timezone by `Date`, silently shifting
	// every timestamp shown to recipients. Reject anything without an explicit "Z" or numeric offset
	// instead of trusting whoever invokes this script to always remember `Z`.
	if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
		console.error(`MIGRATION_START_ISO must include an explicit UTC/offset designator (e.g. a trailing "Z"): ${raw}`);
		process.exit(1);
	}

	migrationStart = new Date(raw);
	if (Number.isNaN(migrationStart.getTime())) {
		console.error(`MIGRATION_START_ISO is not a valid date: ${raw}`);
		process.exit(1);
	}
} else if (mode === 'live') {
	console.error('MIGRATION_START_ISO (exact UTC start of the freeze window) is required for --live');
	process.exit(1);
} else {
	migrationStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
	console.log(`MIGRATION_START_ISO not set — using placeholder date for test send: ${migrationStart.toISOString()}`);
}

const migrationStartTs = Math.floor(migrationStart.getTime() / 1_000);
const freezeEndTs = migrationStartTs + 48 * 60 * 60;

const TEST_RECIPIENT = { guildName: 'NASCAR', ownerId: '223703707118731264' };

// Sourced from the prod ModMail guild-activity table. Two rows had corrupted
// table borders in the source data (owner username/ID ran into the guild-name
// column); their owner IDs below were confirmed via GET /guilds/:id (owner_id)
// against the live prod bot rather than guessed from the garbled text.
//
// `/r/Beastars` and `Hybridgumi Base` below share an owner id -- unverified whether that's the same person
// owning both guilds or a leftover transcription error from the garbled source rows mentioned above (not
// re-checked against GET /guilds/:id the way the two garbled rows were). Either way, sending the same owner
// two separate DMs would be wrong, so `dedupeByOwner` below folds any repeated owner id into a single DM
// naming every guild it owns instead of guessing which entry (if either) is bad.
const OWNERS = [
	{ guildName: 'redsun.tf', ownerId: '832345724984623165' },
	{ guildName: 'Fiendish Whores', ownerId: '424614666363338752' },
	{ guildName: 'Celestrial Boundaries', ownerId: '757759461795561476' },
	{ guildName: 'Dying Light', ownerId: '1133661307699220533' },
	{ guildName: 'Snowbreak: Containment Zone Official', ownerId: '1346409568325996567' },
	{ guildName: 'RetroHandhelds.gg', ownerId: '740981656793645137' },
	{ guildName: 'LunaChat', ownerId: '140250599542226944' },
	{ guildName: '/r/Beastars', ownerId: '237997099432542209' },
	{ guildName: 'Keplerians Community', ownerId: '1303729422276362295' },
	{ guildName: 'Kwite', ownerId: '210131879360200705' },
	{ guildName: 'BobaTalks', ownerId: '1106732401297735783' },
	{ guildName: 'traves', ownerId: '107554096562610176' },
	{ guildName: 'MOTHWING STUDIOS', ownerId: '103980211825041408' },
	{ guildName: 'r/GuitarLessons Official Server', ownerId: '435200177217732633' },
	{ guildName: 'TF2Maps', ownerId: '65497519504764928' },
	{ guildName: 'The Legacy', ownerId: '129594537495625728' },
	{ guildName: 'Reddit Mods', ownerId: '121844510077616130' },
	{ guildName: 'Game Industry Coffee Chat', ownerId: '297236824198217729' },
	{ guildName: 'NEVNATION', ownerId: '220600468169162753' },
	{ guildName: 'Hybridgumi Base', ownerId: '237997099432542209' },
	{ guildName: 'SeanDaBlack', ownerId: '649967235888054282' },
];

const ACCENT_COLOR = 0x5865f2; // Discord blurple

// Components V2 type ids (no SDK enum available in a dependency-free script).
const COMPONENT = { TEXT_DISPLAY: 10, SEPARATOR: 14, CONTAINER: 17 };
const IS_COMPONENTS_V2 = 1 << 15;

function text(content) {
	return { type: COMPONENT.TEXT_DISPLAY, content };
}

function separator() {
	return { type: COMPONENT.SEPARATOR, divider: true, spacing: 2 };
}

// `Intl.ListFormat` gives the natural "A", "A and B", "A, B, and C" phrasing for however many guilds this
// owner has -- almost always one, occasionally more (see the `OWNERS` comment on shared owner ids above).
const guildListFormatter = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

function buildComponents(guildNames) {
	const guildList = guildListFormatter.format(guildNames.map((name) => `**${name}**`));

	return [
		{
			type: COMPONENT.CONTAINER,
			accent_color: ACCENT_COLOR,
			components: [
				text('# ModMail is getting a major upgrade'),
				text(
					`Hey! We wanted to give you a heads up as the owner of ${guildList} on ModMail ` +
						`about some big changes coming your way.`,
				),
				separator(),
				text(
					`## What's new\n` +
						`• A full **web dashboard** for configuring ModMail - panels, categories, snippets, and blocks.\n` +
						`• A switch to a **ticket-based system**. Users open a ticket from inside your server instead of ` +
						`DMing the bot, landing in a private thread only staff can see. On your end it looks and works ` +
						`exactly like it does today — a ticket in your mod forum with the full conversation.\n` +
						`• All of your **existing ModMail history will be migrated** — nothing gets left behind.`,
				),
				separator(),
				text(
					`## The migration\n` +
						`The switch starts **<t:${migrationStartTs}:F>** (<t:${migrationStartTs}:R>):\n` +
						`1. For **48 hours** from that moment, no new ModMail threads can be opened. Anything already ` +
						`open keeps working as normal.\n` +
						`2. At **<t:${freezeEndTs}:F>**, we force-close every open thread and run the migration — moving ` +
						`your full history over and swapping the bot to the new system.\n` +
						`3. Once that's done, you're live on the new ticket-based ModMail, dashboard and all.\n\n` +
						`**Please check your dashboard settings as soon as the switch completes** ` +
						`— configuring a panel will be mandatory to continue using the bot.`,
				),
				separator(),
				text(
					`**Stay in the loop:** join our support server to follow updates and ask us anything:\n` +
						`https://discord.gg/tgZ2pSgXXv`,
				),
				separator(),
				text(
					`Thank you so much for sticking with us — some of you have been running ModMail for years, and ` +
						`it means a lot. We're excited for you to try the new version.\n\n` +
						`— The ChatSift team`,
				),
			],
		},
	];
}

async function sendDm(userId, components) {
	const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
		method: 'POST',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ recipient_id: userId }),
	});
	if (!dmRes.ok) {
		throw new Error(`createDM failed for ${userId}: ${dmRes.status} ${await dmRes.text()}`);
	}

	const dmChannel = await dmRes.json();

	const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
		method: 'POST',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ flags: IS_COMPONENTS_V2, components }),
	});
	if (!msgRes.ok) {
		throw new Error(`sendMessage failed for ${userId}: ${msgRes.status} ${await msgRes.text()}`);
	}
}

/**
 * Folds repeated owner ids in `entries` into one `{ ownerId, guildNames }` per owner, preserving each
 * owner's first-seen order and each owner's guilds in list order -- so a shared owner (see the `OWNERS`
 * comment above) gets exactly one DM naming every guild they own instead of one per guild.
 */
function dedupeByOwner(entries) {
	const byOwnerId = new Map();

	for (const { guildName, ownerId } of entries) {
		const existing = byOwnerId.get(ownerId);
		if (existing) {
			existing.guildNames.push(guildName);
		} else {
			byOwnerId.set(ownerId, { ownerId, guildNames: [guildName] });
		}
	}

	return [...byOwnerId.values()];
}

const recipients =
	mode === 'test'
		? [{ ownerId: TEST_RECIPIENT.ownerId, guildNames: [TEST_RECIPIENT.guildName] }]
		: dedupeByOwner(OWNERS);

console.log(`Mode: ${mode}. Sending to ${recipients.length} recipient(s).`);

for (const { guildNames, ownerId } of recipients) {
	const label = `${guildNames.join(', ')} (${ownerId})`;

	try {
		await sendDm(ownerId, buildComponents(guildNames));
		console.log(`OK   ${label}`);
	} catch (error) {
		console.error(`FAIL ${label}: ${error.message}`);
	}

	// gentle pacing, avoid hammering the createDM/message rate limits
	await setTimeout(750);
}
