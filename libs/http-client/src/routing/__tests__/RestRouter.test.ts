import { container } from 'tsyringe';
import { Rest } from '../../rest';
import { buildRestRouter } from '../RestRouter';

const mockedMake = jest.fn();

container.register<unknown>(Rest, {
  useValue: { make: mockedMake }
});

const router = buildRestRouter();

afterEach(() => mockedMake.mockClear());

test('it can properly make a request', () => {
  const parameter = '123';
  const data = { a: 'b' };

  void router.users![parameter]!.post(data);

  expect(mockedMake).toHaveBeenCalledWith(`/users/${parameter}`, 'post', data);
});
