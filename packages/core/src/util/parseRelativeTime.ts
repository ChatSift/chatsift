/**
 * @remarks
 * This is used for various ops, hence the <T>
 */
type TimeParserResult<T> =
	| {
			error: string;
			ok: false;
	  }
	| {
			ok: true;
			value: T;
	  };

const oneMs = 1;
const oneSecond = 1_000;
const oneMinute = 60_000;
const oneHour = oneMinute * 60;
const oneDay = oneHour * 24;
const oneWeek = oneDay * 7;
// Let's treat months as 28 days
const oneMonth = oneDay * 28;

const MS_VALUE_LOOKUP = {
	milisecond: oneMs,
	second: oneSecond,
	minute: oneMinute,
	hour: oneHour,
	day: oneDay,
	week: oneWeek,
	month: oneMonth,
} as const;

/* eslint-disable id-length */
const MS_VALUE_ALIAS_LOOKUP = {
	ms: 'milisecond',

	s: 'second',
	se: 'second',
	sec: 'second',

	// I don't like "m" because of ambiguity, but given stuff like "30m" should be p common and intuitive, it's ok
	m: 'minute',
	min: 'minute',

	h: 'hour',
	hr: 'hour',

	d: 'day',

	w: 'week',
	wk: 'week',

	mo: 'month',
	mon: 'month',
} as const satisfies Record<string, keyof typeof MS_VALUE_LOOKUP>;
/* eslint-enable id-length */

function retrieveMsValue(unit: string): TimeParserResult<number> {
	// First off, none of our aliases or values in the lookup table have keys ending with "s",
	// which should always indicate plural. We can simply strip that away.
	const identifier = unit.endsWith('s') ? unit.slice(0, -1) : unit;

	if (identifier in MS_VALUE_LOOKUP) {
		const value = MS_VALUE_LOOKUP[identifier as keyof typeof MS_VALUE_LOOKUP];
		return { ok: true, value };
	}

	if (identifier in MS_VALUE_ALIAS_LOOKUP) {
		const key = MS_VALUE_ALIAS_LOOKUP[identifier as keyof typeof MS_VALUE_ALIAS_LOOKUP];
		const value = MS_VALUE_LOOKUP[key];
		return { ok: true, value };
	}

	return { ok: false, error: `Unknown time unit "${unit}"` };
}

function isDigit(char: string): boolean {
	return char >= '0' && char <= '9';
}

/**
 * @remarks
 * Step 1. Until we're at end of input or we run into a non-digit character, keep consuming characters.
 * Step 2. If we didn't consume anything, return an error.
 * Step 3. Parse the integer and return it, along with what's left of our input.
 */
function parseNumber(input: string): TimeParserResult<{ number: number; remaining: string }> {
	let len = 0;
	let idx = 0;

	while (idx < input.length && isDigit(input[idx]!)) {
		len++;
		idx++;
	}

	if (!len) {
		return { ok: false, error: 'There was no number to parse' };
	}

	const number = Number.parseInt(input.slice(0, len), 10);
	return { ok: true, value: { number, remaining: input.slice(len) } };
}

/**
 * @remarks
 * Step 1. Until we're at end of input or we run into a digit character, keep consuming characters.
 * Step 2. If we didn't consume anything, assume minutes.
 * Step 3. Look up the time value of the unit and return it, along with what's left of our input.
 */
function parseUnitTime(input: string): TimeParserResult<{ remaining: string; time: number }> {
	let len = 0;
	let idx = 0;

	while (idx < input.length && !isDigit(input[idx]!)) {
		len++;
		idx++;
	}

	// No unit found. Assume minutes.
	if (!len) {
		return { ok: true, value: { time: MS_VALUE_LOOKUP.minute, remaining: input } };
	}

	const unit = input.slice(0, len);
	const time = retrieveMsValue(unit);

	// Simply bubble the error up
	if (!time.ok) {
		return time;
	}

	return { ok: true, value: { time: time.value, remaining: input.slice(len) } };
}

/**
 * @remarks
 * Step 1. Parse a number. This represents the amount of a given unit.
 * Step 2. Parse a unit. This represents the unit of time.
 * Step 3. Multiply the number by the unit's value.
 * Step 4. Return the value. Errors may be bubbled up at any point.
 */
function parseChunk(input: string): TimeParserResult<{ ms: number; remaining: string }> {
	const number = parseNumber(input);

	// Bubble up the error.
	if (!number.ok) {
		return number;
	}

	// Note that `number.value.remaining` is our input after the previous parsing step's character consumption.
	const unitTime = parseUnitTime(number.value.remaining);

	// Bubble up the error.
	if (!unitTime.ok) {
		return unitTime;
	}

	const ms = number.value.number * unitTime.value.time;
	return { ok: true, value: { remaining: unitTime.value.remaining, ms } };
}

/**
 * @remarks
 * Step 1. If we're at the end of input, return the total.
 * Step 2. Parse a chunk and add it to the total, bubble errors up if need be.
 * Step 3. Recurse (start back at step 1 with the remaining input and the new total).
 */
function parseRecursive(input: string, totalMs = 0): TimeParserResult<number> {
	// We're done, return the total
	if (!input.length) {
		return { ok: true, value: totalMs };
	}

	const chunk = parseChunk(input);

	// Bubble up the error.
	if (!chunk.ok) {
		return chunk;
	}

	const newTotal = totalMs + chunk.value.ms;

	// Recurse
	return parseRecursive(chunk.value.remaining, newTotal);
}

/**
 * @remarks
 * Step 1. Strip all whitespace away.
 * Step 2. Recursively parse the input, bubble up any errors that occur.
 * Step 3. If the value is less than a minute, return an error.
 * Step 4. Return the value.
 */
export function parseRelativeTime(input: string): TimeParserResult<number> {
	const stripped = input.replaceAll(/\s/g, '');
	const parsed = parseRecursive(stripped);

	// Bubble up the error.
	if (!parsed.ok) {
		return parsed;
	}

	// Special handling for <1min
	if (parsed.value < MS_VALUE_LOOKUP.minute) {
		return { ok: false, error: 'Please provide a time greater than or equal to a minute.' };
	}

	return { ok: true, value: parsed.value };
}
