import { groupBy } from '../util';

test('grouping by a key', () => {
	const one = { key: 'a', value: 0 };
	const two = { key: 'b', value: 1 };
	const three = { key: 'c', value: 2 };

	const data = [one, two, three];

	expect(groupBy(data, (e) => e.key)).toStrictEqual({
		a: [one],
		b: [two],
		c: [three],
	});
});
