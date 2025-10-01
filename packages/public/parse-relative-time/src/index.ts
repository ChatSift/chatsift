/* eslint-disable jsdoc/no-undefined-types */

/**
 * @remarks
 * This is used for various ops, hence the <T>
 */
type TimeParserResult<Value> =
	| {
			message: string;
			ok: false;
	  }
	| {
			ok: true;
			value: Value;
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
	miliseconds: 'milisecond',

	s: 'second',
	se: 'second',
	sec: 'second',
	secs: 'second',
	seconds: 'second',

	// I don't like "m" because of ambiguity, but given stuff like "30m" should be p common and intuitive, it's ok
	m: 'minute',
	min: 'minute',
	mins: 'minute',
	minutes: 'minute',

	h: 'hour',
	hr: 'hour',
	hrs: 'hour',
	hours: 'hour',

	d: 'day',
	days: 'day',

	w: 'week',
	wk: 'week',
	wks: 'week',
	weeks: 'week',

	mo: 'month',
	mos: 'month',
	mon: 'month',
	mons: 'month',
	months: 'month',
} as const satisfies Record<string, keyof typeof MS_VALUE_LOOKUP>;
/* eslint-enable id-length */

function retrieveMsValue(unit: string): TimeParserResult<number> {
	if (unit in MS_VALUE_LOOKUP) {
		const value = MS_VALUE_LOOKUP[unit as keyof typeof MS_VALUE_LOOKUP];
		return { ok: true, value };
	}

	if (unit in MS_VALUE_ALIAS_LOOKUP) {
		const key = MS_VALUE_ALIAS_LOOKUP[unit as keyof typeof MS_VALUE_ALIAS_LOOKUP];
		const value = MS_VALUE_LOOKUP[key];
		return { ok: true, value };
	}

	return { ok: false, message: `Unknown time unit "${unit}"` };
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
		return { ok: false, message: 'There was no number associated with one of the units.' };
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
 * Functionally the same as {@link parseRelativeTime}, but actually returns the `Result` type/object being used internally
 */
export function parseRelativeTimeSafe(input: string): TimeParserResult<number> {
	const stripped = input.replaceAll(/\s/g, '');
	return parseRecursive(stripped);
}

/**
 * Recursively parses a string representing relative time.
 *
 * Extremely lenient, supports stuff like "1d 2h 3m 4s 5ms" and "1d2h3m4s5ms".
 *
 * For a list of supported units, please refer to {@link MS_VALUE_LOOKUP} and {@link MS_VALUE_ALIAS_LOOKUP}.
 *
 * @returns - The parsed time in milliseconds, or an error if parsing failed.
 */
export function parseRelativeTime(input: string): number {
	const parsed = parseRelativeTimeSafe(input);
	if (parsed.ok) {
		return parsed.value;
	}

	throw new Error(parsed.message);
}
