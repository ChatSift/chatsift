import { groupBy, sectionArray } from '../util';

test('groupBy', () => {
  expect(groupBy(['a', 'b', 'c', 'aa', 'bb', 'cc'], item => String(item.length))).toStrictEqual({
    1: ['a', 'b', 'c'],
    2: ['aa', 'bb', 'cc']
  });
});

test('sectionArray', () => {
  expect(sectionArray(Array(20).fill(0), 5)).toStrictEqual(Array(4).fill(Array(5).fill(0)));
});
