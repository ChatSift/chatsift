interface HeadingProps {
	readonly subtitle?: string | undefined;
	readonly title: string;
}

export default function Heading({ title, subtitle }: HeadingProps) {
	return (
		<div className="g-3 flex flex-col">
			<p className="text-2xl font-medium text-primary">{title}</p>
			{subtitle && <p className="text-lg font-normal text-secondary">{subtitle}</p>}
		</div>
	);
}
