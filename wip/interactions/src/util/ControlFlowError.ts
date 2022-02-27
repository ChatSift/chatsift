/**
 * A simple error class for the simple sake of instanceof checking
 *
 * Used to report non-internal errors for a user
 */
export class ControlFlowError extends Error {
	public static isControlFlowError(error: any): error is ControlFlowError {
		return error instanceof ControlFlowError;
	}
}
