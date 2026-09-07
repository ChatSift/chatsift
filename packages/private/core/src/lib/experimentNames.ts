/**
 * Names of the experiment gates the code actually checks (`experiments.name`).
 *
 * Here rather than as a string literal at each call site because a gate is only useful when every layer agrees
 * on its name: `services/api` refuses the write, `services/ama-bot` hides the button, and `apps/website` hides
 * the control, all off the same row. A typo in any one of them is a gate that silently does nothing in that
 * layer -- and `isExperimentEnabled` treats an unknown name as *off*, so the typo'd side fails closed and looks
 * like "the feature just isn't on" rather than like a bug.
 *
 * Browser-safe (`@chatsift/core`, not `backend-core`) so the dashboard can import the same constant it filters
 * `MeGuild.experiments` with.
 */

/**
 * #366's AMA quality-of-life work: per-question anonymity and staff-authored umbrella questions. One gate over
 * both -- they shipped together for one request, and splitting them would mean operating two bucket ranges for
 * a rollout nobody has asked to stage separately.
 *
 * Gates the *write* paths and the UI that reaches them, never rendering: a question already published without
 * an author keeps rendering that way if the gate is later switched off. Turning a kill switch off must not
 * retroactively name someone who was published anonymously.
 */
export const AMA_QOL_EXPERIMENT = 'ama-qol';
