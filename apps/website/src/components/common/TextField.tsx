interface TextFieldProps {
	/**
	 * Renders the input non-editable while leaving it (and its `helper`) on screen -- for fields whose value
	 * is forced by another setting, where hiding them would leave no room to explain why.
	 */
	readonly disabled?: boolean;
	readonly error?: string | undefined;
	readonly helper?: React.ReactNode;
	readonly id: string;
	readonly label: string;
	readonly max?: number;
	readonly maxLength?: number;
	readonly min?: number;
	onBlur?(): void;
	onChange(value: string): void;
	readonly placeholder?: string;
	/**
	 * A control sharing the input's row -- in practice the Add button beside the box it reads from. It belongs
	 * inside the field rather than beside it so `label` stays above the pair and `helper`/`error` stay below
	 * both; a button aligned against the outside of the field drifts down the moment either appears. Size it
	 * with `buttonClass(..., 'field')`, which matches the input's box exactly.
	 */
	readonly trailing?: React.ReactNode;
	readonly type?: 'datetime-local' | 'number' | 'text' | 'url';
	readonly value: string;
}

/**
 * A labeled text/number/url input with the standard error + helper-text layout shared by every dashboard form.
 * `helper` renders between the input and the error message, for fields that need a hint, a link, or a live preview.
 */
export function TextField({
	id,
	label,
	value,
	onChange,
	onBlur,
	error,
	helper,
	type = 'text',
	placeholder,
	maxLength,
	min,
	max,
	disabled = false,
	trailing,
}: TextFieldProps) {
	const errorId = `${id}-error`;
	const helperId = `${id}-helper`;
	const describedBy = [helper && helperId, error && errorId].filter(Boolean).join(' ') || undefined;

	return (
		<div>
			<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor={id}>
				{label}
			</label>
			<div className="flex items-start gap-2">
				<input
					aria-describedby={describedBy}
					aria-invalid={error ? true : undefined}
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent disabled:cursor-not-allowed disabled:opacity-50 dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					disabled={disabled}
					id={id}
					max={max}
					maxLength={maxLength}
					min={min}
					onBlur={onBlur}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					type={type}
					value={value}
				/>
				{trailing}
			</div>
			{helper &&
				// A plain string gets the standard helper styling; every other caller passes an already-styled node
				// (a live preview, a hint with a link) and keeps full control. Without this a bare string rendered at
				// body size in the primary text colour, flush against the input -- louder than the label above it.
				(typeof helper === 'string' ? (
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark" id={helperId}>
						{helper}
					</p>
				) : (
					<div id={helperId}>{helper}</div>
				))}
			{error && (
				<p className="mt-1 text-sm text-misc-danger" id={errorId}>
					{error}
				</p>
			)}
		</div>
	);
}
