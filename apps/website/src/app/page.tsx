import { ExternalLink } from 'lucide-react';

export default async function HomePage() {
	return (
		<div className="flex flex-col items-start justify-center gap-6 px-4 py-2 md:px-6">
			<h1 className="max-w-full text-balance text-3xl font-medium">Modern solutions for your Discord communities</h1>

			<div>
				<a
					className="text-primary-dark flex justify-center gap-2 rounded-md bg-misc-accent px-4 py-2 text-lg md:inline-flex"
					href="/support"
					rel="noopener noreferrer"
					target="_blank"
				>
					Join our Discord server <ExternalLink aria-hidden size={20} className="my-auto" />
				</a>
			</div>
		</div>
	);
}
