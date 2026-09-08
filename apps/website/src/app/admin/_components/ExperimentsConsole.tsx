'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { EmptyState } from '@chatsift/web-core/components/EmptyState';
import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useState } from 'react';
import { FaFlask } from 'react-icons/fa';
import { ExperimentCard } from './ExperimentCard';
import { ExperimentForm } from './ExperimentForm';
import { GuildChecker } from './GuildChecker';
import { useExperiments } from '@/api/routes/experiments';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function ExperimentsConsole() {
	const { data: experiments, error, isLoading } = useExperiments();
	const [isCreating, setIsCreating] = useState(false);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !experiments) {
		return <Skeleton className="h-[50vh] w-full" />;
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading
					subtitle="Feature gates, by share of guilds and by explicit override. Bots re-read these every 60 seconds, so a change here needs no deploy."
					title="Experiments"
				/>
				{!isCreating && (
					<Button className={buttonClass('primary')} onPress={() => setIsCreating(true)}>
						New experiment
					</Button>
				)}
			</div>

			{isCreating && <ExperimentForm onDone={() => setIsCreating(false)} />}

			{experiments.length === 0 ? (
				<EmptyState
					icon={<FaFlask className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
					subtitle="Code that calls isExperimentEnabled with a name that has no row here is off. Create the gate to turn it on."
					title="No experiments yet"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{experiments.map((experiment) => (
						<ExperimentCard experiment={experiment} key={experiment.name} />
					))}
				</div>
			)}

			<GuildChecker experiments={experiments} />
		</div>
	);
}
