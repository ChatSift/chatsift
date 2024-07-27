import { expect, test } from 'vitest';
import { parseRelativeTime } from '../index';

test('empty input', () => {
	const result = parseRelativeTime('');
	expect(result).toEqual(0);
});

test('simple ms', () => {
	const result = parseRelativeTime('100ms');
	expect(result).toEqual(100);
});

test('single unit', () => {
	const result = parseRelativeTime('1m');
	expect(result).toEqual(60_000);
});

test('multiple units', () => {
	const result = parseRelativeTime('1d 2h 3m 4s 5ms');
	expect(result).toEqual(93_784_005);
});

test('multiple units without spaces', () => {
	const result = parseRelativeTime('1d2h3m4s5ms');
	expect(result).toEqual(93_784_005);
});

test('unknown unit', () => {
	expect(() => parseRelativeTime('1x')).toThrow('Unknown time unit "x"');
});

test('no number to parse', () => {
	expect(() => parseRelativeTime('s')).toThrow('There was no number associated with one of the units.');
});

test('empty chunk', () => {
	const result = parseRelativeTime('1s  ');
	expect(result).toEqual(1_000);
});

test('plural unit', () => {
	const result = parseRelativeTime('2weeks');
	expect(result).toEqual(1_209_600_000);
});

test('alias unit', () => {
	const result = parseRelativeTime('1hr');
	expect(result).toEqual(3_600_000);
});

test('alias unit with plural', () => {
	const result = parseRelativeTime('2mos');
	expect(result).toEqual(4_838_400_000);
});

test('longer input with inconsistent spacing and implicit ms', () => {
	const result = parseRelativeTime('1d       2h3m  4s 5ms           6');
	expect(result).toEqual(94_144_005);
});
