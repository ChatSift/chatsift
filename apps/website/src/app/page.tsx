import { ExternalLink } from 'lucide-react';

export default function Home() {
	return (
		<div className="flex flex-col">
			<main className="flex flex-col justify-center max-w-[80vw] md:min-w-[912px] m-auto gap-6 pt-6">
				<h1 className="text-3xl font-semibold">Modern solutions for your Discord communities</h1>

				<div>
					<a
						className="md:inline-flex flex justify-center gap-2 bg-misc-accent rounded-md px-4 py-3 font-medium text-lg"
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
