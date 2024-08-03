import { ExternalLink } from 'lucide-react';

export default function Home() {
	return (
		<div className="flex flex-col">
			<main className="mx-auto flex max-w-[80vw] flex-col justify-center gap-6 pt-6 md:min-w-[912px]">
				<h1 className="text-3xl font-medium">Modern solutions for your Discord communities</h1>

				<div>
					<a
						className="flex justify-center gap-2 rounded-md bg-misc-accent px-4 py-3 text-lg font-[550] text-primary-dark md:inline-flex"
						href="/support"
						rel="noopener noreferrer"
						target="_blank"
					>
						Join our Discord server <ExternalLink aria-hidden size={20} />
					</a>
				</div>
			</main>
		</div>
	);
}
