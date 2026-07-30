interface TextAreaFieldProps {
	readonly error?: string | undefined;
	readonly helper?: React.ReactNode;
	readonly id: string;
	readonly label: string;
	readonly maxLength?: number;
	onChange(value: string): void;
	readonly placeholder?: string;
	readonly rows?: number;
	readonly value: string;
}

/**
 * Textarea counterpart to `TextField` -- same labeled/error/helper layout, used for descriptions, greeting
 * messages, and other multi-line content across the modmail and AMA forms.
 */
export function TextAreaField({
	id,
	label,
	value,
	onChange,
	error,
	helper,
	placeholder,
	maxLength,
	rows = 3,
}: TextAreaFieldProps) {
	const errorId = `${id}-error`;
	const helperId = `${id}-helper`;
	const describedBy = [helper && helperId, error && errorId].filter(Boolean).join(' ') || undefined;

	return (
		<div>
			<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor={id}>
				{label}
			</label>
			<textarea
				aria-describedby={describedBy}
				aria-invalid={error ? true : undefined}
				className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
				id={id}
				maxLength={maxLength}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				rows={rows}
				value={value}
			/>
			{helper && <div id={helperId}>{helper}</div>}
			{error && (
				<p className="mt-1 text-sm text-misc-danger" id={errorId}>
					{error}
				</p>
			)}
		</div>
	);
}
