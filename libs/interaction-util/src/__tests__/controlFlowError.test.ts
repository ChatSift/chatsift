import { ControlFlowError } from '../';

test('isControlFlowError', () => {
  const error = new ControlFlowError('boop');
  expect(ControlFlowError.isControlFlowError(error)).toBe(true);
});
