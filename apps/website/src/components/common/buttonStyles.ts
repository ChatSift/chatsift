import { cn } from '@/utils/util';

export type ButtonVariant = 'danger' | 'primary' | 'secondary';

/**
 * - `md` -- the page-level submit: the single "Save changes" a settings form ends on, and the pair
 *   `FormActions` renders.
 * - `field` -- a button sitting on the same row as a `TextField`/`ChannelSelect`/`RoleSelect`. Matches that
 *   control's box exactly (same padding and text size, plus a transparent border standing in for the input's
 *   1px one), because a button beside an input that is 10px shorter than it reads as misaligned no matter how
 *   the row is aligned.
 * - `sm` -- an action inside a row of text: a listed domain's Remove, a detail page's action bar.
 *
 * The split exists because AutoModerator's pages are built out of cards rather than one long form (#374), so
 * applying the submit recipe to every action there produced rows of 48px pills next to `text-sm` labels --
 * visibly heavier than the same controls under AMA, ModMail and Social, which only ever reach for `md` on a
 * form's actual submit.
 */
export type ButtonSize = 'field' | 'md' | 'sm';

const BASE = 'rounded-md disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
	primary: 'bg-misc-accent text-accent transition-opacity hover:opacity-90',
	secondary:
		'bg-on-tertiary text-primary transition-colors hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark',
	danger: 'bg-misc-danger/10 text-misc-danger transition-opacity hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
	md: 'px-3 py-2.5',
	// Mirrors `TextField`'s input and `ChannelSelect`/`RoleSelect`'s trigger: `border px-3 py-2 text-base`.
	field: 'border border-transparent px-3 py-2 text-base',
	// `text-sm` is spelled out because `Button`'s own base sets `text-lg`; `md` deliberately inherits it.
	sm: 'px-2.5 py-1.5 text-sm',
};

export function buttonClass(variant: ButtonVariant, size: ButtonSize = 'md'): string {
	return cn(BASE, VARIANTS[variant], SIZES[size]);
}
