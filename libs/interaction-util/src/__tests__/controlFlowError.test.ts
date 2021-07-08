import { ControlFlowError } from '../ControlFlowError';

test('isControlFlowError', () => {
  const error = new ControlFlowError('boop');
  expect(ControlFlowError.isControlFlowError(error)).toBe(true);
});
