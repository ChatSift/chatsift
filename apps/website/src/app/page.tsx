import { ExternalLink } from 'lucide-react';

export default async function HomePage() {
	return (
		<>
			<h1 className="text-3xl font-medium">Modern solutions for your Discord communities</h1>

			<div>
				<a
					className="text-primary-dark flex justify-center gap-2 rounded-md bg-misc-accent px-4 py-3 text-lg font-[550] md:inline-flex"
					href="/support"
					rel="noopener noreferrer"
					target="_blank"
				>
					Join our Discord server <ExternalLink aria-hidden size={20} className="my-auto" />
				</a>
			</div>
		</>
	);
}
