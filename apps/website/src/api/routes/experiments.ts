import type {
	deleteExperimentRoute,
	InferRouteContract,
	listExperimentsRoute,
	upsertExperimentRoute,
} from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListContract = InferRouteContract<typeof listExperimentsRoute>;
export type ExperimentList = ListContract['response'];
export type Experiment = ExperimentList[number];

type UpsertContract = InferRouteContract<typeof upsertExperimentRoute>;
export type UpsertExperimentBody = UpsertContract['body'];
export type UpsertExperimentResult = UpsertContract['response'];

type DeleteContract = InferRouteContract<typeof deleteExperimentRoute>;

/**
 * Every experiment plus its full override list, for `/admin`. Global-admin only server-side, so a non-admin
 * who reaches this at all gets a 403 rather than an empty list -- the page gates on `me.isGlobalAdmin` before
 * mounting, which is what keeps that from being the normal path.
 */
export function useExperiments() {
	return useQuery({
		queryKey: queryKeys.experiments.all,
		queryFn: async () => apiFetch<ExperimentList>('get', '/v3/experiments'),
	});
}

export function useUpsertExperiment() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ name, body }: { body: UpsertExperimentBody; name: string }) =>
			apiFetch<UpsertExperimentResult>('put', `/v3/experiments/${name}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.experiments.all });
		},
	});
}

export function useDeleteExperiment() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (name: string) => apiFetch<DeleteContract['response']>('delete', `/v3/experiments/${name}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.experiments.all });
		},
	});
}
