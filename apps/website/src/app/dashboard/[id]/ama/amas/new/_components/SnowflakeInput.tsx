interface SnowflakeInputProps {
	readonly error?: string | undefined;
	readonly id: string;
	readonly label: string;
	onChange(value: string): void;
	readonly placeholder?: string;
	readonly required?: boolean;
	readonly value: string;
}

export function SnowflakeInput({
	id,
	label,
	value,
	onChange,
	error,
	placeholder = '123456789012345678',
	required = false,
}: SnowflakeInputProps) {
	return (
		<div>
			<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor={id}>
				{label} {required && '*'}
			</label>
			<input
				className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
				id={id}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				type="text"
				value={value}
			/>
			{error && <p className="mt-1 text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
