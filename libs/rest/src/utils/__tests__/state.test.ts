import { State } from '../state';

jest.useFakeTimers();

const REDIRECT_URI = 'https://foo.bar' as const;

const NOW = new Date();
const NONCE = Buffer.from(Array(16).fill(1));
const TIME = Buffer.alloc(4);

TIME.writeUInt32LE(Math.floor(NOW.getTime() / 1000));

jest.mock('crypto', () => {
	const original: typeof import('crypto') = jest.requireActual('crypto');
	return {
		...original,
		randomBytes: (len: number) => Buffer.from(Array(len).fill(1)),
	};
});

global.Date = jest.fn().mockReturnValue(NOW) as DateConstructor;

test('constructing a state', () => {
	const state = new State(REDIRECT_URI);
	expect(state.redirectUri).toBe(REDIRECT_URI);
	expect(state.toBytes()).toStrictEqual(Buffer.concat([NONCE, TIME, Buffer.from(REDIRECT_URI)]));
	expect(state.toString()).toBe(Buffer.concat([NONCE, TIME, Buffer.from(REDIRECT_URI)]).toString('base64'));
});

test('getting a state object back', () => {
	const state = State.from('AQEBAQEBAQEBAQEBAQEBAcKegmBodHRwczovL2Zvby5iYXI=');
	expect(state.redirectUri).toBe(REDIRECT_URI);
});
