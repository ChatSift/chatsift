import type { AmaQuestions, AmaQuestionsId, AmaQuestionState, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { expect, test, vi } from 'vitest';

// `util.ts` transitively imports `@chatsift/backend-core`, which parses `process.env` at module-load time
// -- see `stubTestEnv`'s doc comment.
vi.mock('@chatsift/backend-core', async (importActual) => {
	const { stubTestEnv } = await import('../../../../__tests__/stubEnv.js');
	stubTestEnv();

	return importActual();
});

// `util.ts` also pulls in the Discord REST clients, which are constructed at module scope. Nothing under
// test here reaches Discord (`resolveCurrentQueueMessage` is pure), so stubbing the modules out entirely
// is enough to make the import work.
vi.mock('../../../../util/discordAPI.js', () => ({ apiForGuild: vi.fn(), discordAPIAma: {} }));
vi.mock('../../../../util/users.js', () => ({ resolveDiscordUser: vi.fn() }));

const { resolveCurrentQueueMessage } = await import('../util.js');

const GUILD = '1425493115053019319';
const QUEUE_CHANNEL = '1425493115053019320';
const ANSWERS_CHANNEL = '1425493115053019321';

function session(overrides: Partial<AmaSessions> = {}): AmaSessions {
	return {
		id: 1 as AmaSessionsId,
		guildId: GUILD,
		queueId: QUEUE_CHANNEL,
		title: 'AMA',
		answersChannelId: ANSWERS_CHANNEL,
		promptChannelId: '1425493115053019322',
		allowedQuestionUploads: 0,
		ended: false,
		createdAt: new Date(0),
		scheduledCloseAt: null,
		preparedAnswersEnabled: false,
		reviewEnabled: true,
		shareToken: 'token',
		guestIds: [],
		maxQuestionsPerUser: null,
		...overrides,
	};
}

// kanel generates `ama_question_state` as a real TS enum but `@chatsift/db` only re-exports its *type*
// (see `routes/ama/constants.ts`), so there's no runtime member to reference here -- hence taking the
// literal and casting once, rather than at all seven call sites.
type StateLiteral = 'APPROVED' | 'ASKED' | 'DENIED' | 'PENDING_REVIEW';

function question(state: StateLiteral, overrides: Partial<AmaQuestions> = {}): AmaQuestions {
	return {
		id: 1 as AmaQuestionsId,
		amaId: 1 as AmaSessionsId,
		authorId: '123',
		state: state as AmaQuestionState,
		content: 'why?',
		queueMessageId: '900',
		answersMessageId: '901',
		createdAt: new Date(0),
		updatedAt: new Date(0),
		answerContent: null,
		answerImageUrl: null,
		answeredById: null,
		answeredAt: null,
		askedAt: null,
		...overrides,
	};
}

test('a pending question resolves to its queue message', () => {
	expect(resolveCurrentQueueMessage(question('PENDING_REVIEW'), session())).toStrictEqual({
		channelId: QUEUE_CHANNEL,
		kind: 'queue',
		messageId: '900',
	});
});

test('an approved question keeps pointing at the queue message it was posted to', () => {
	expect(resolveCurrentQueueMessage(question('APPROVED'), session())).toStrictEqual({
		channelId: QUEUE_CHANNEL,
		kind: 'queue',
		messageId: '900',
	});
});

test('an asked question resolves to its answers-channel message', () => {
	expect(resolveCurrentQueueMessage(question('ASKED'), session())).toStrictEqual({
		channelId: ANSWERS_CHANNEL,
		kind: 'answers',
		messageId: '901',
	});
});

// #316: the whole point of a public-page-only AMA is that nothing was ever posted, so there's no live
// message for any caller (the answer-edit path, merge's re-render) to go and keep in sync.
test('an asked question in a public-page-only AMA has no live message', () => {
	const publicPageOnly = session({ answersChannelId: null });

	expect(resolveCurrentQueueMessage(question('ASKED', { answersMessageId: null }), publicPageOnly)).toBeNull();
});

// An AMA switched to public-page-only *after* some questions went out keeps their `answers_message_id`,
// but a message can only be addressed as (channel, message) -- with no channel there's nothing to reach.
test('a stale answers_message_id without a channel resolves to nothing', () => {
	expect(resolveCurrentQueueMessage(question('ASKED'), session({ answersChannelId: null }))).toBeNull();
});

test('a dash-only-review question with no queue channel has no live message', () => {
	expect(
		resolveCurrentQueueMessage(question('PENDING_REVIEW', { queueMessageId: null }), session({ queueId: null })),
	).toBeNull();
});

test('a denied question has no live message', () => {
	expect(resolveCurrentQueueMessage(question('DENIED'), session())).toBeNull();
});
