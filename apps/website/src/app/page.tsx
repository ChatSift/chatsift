import { ExternalLink } from 'lucide-react';

export default function Home() {
	return (
		<main className="flex flex-col max-w-screen-md m-auto gap-3 pt-6">
			<h1 className="text-3xl font-semibold">Modern solutions for your Discord communities</h1>

			<div>
				<a
					className="inline-flex gap-2 bg-misc-accent rounded-md px-4 py-3 font-medium text-lg"
					href="/support"
					rel="noopener noreferrer"
					target="_blank"
				>
					Join our Discord server <ExternalLink aria-hidden size={20} />
				</a>
			</div>
		</main>
	);
}
