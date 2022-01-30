import { chunkArray, groupBy } from '../index';

test('chunkArray', () => {
	const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	const chunks = chunkArray(data, 3);

	expect(chunks).toStrictEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
});

test('groupBy', () => {
	const data = [0, 1, 2, 3, 4, 5, 6];
	const grouper = (x: number) => (x % 2 === 0 ? 'even' : 'odd');
	const grouped = groupBy(data, grouper);

	expect(grouped).toStrictEqual({
		even: [0, 2, 4, 6],
		odd: [1, 3, 5],
	});
});
