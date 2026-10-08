import { useQuery } from '@tanstack/react-query';
import type { ActionsResponse, AttentionFactorKey, SchemeInfo } from '@sevalens/shared';
import { api } from './api';

export interface Meta {
  dataAsOf: string;
  computedAt: string;
  schemes: SchemeInfo[];
  districts: { id: number; name: string; code: string }[];
  blocks: { id: number; name: string; districtId: number }[];
  weights: Record<AttentionFactorKey, number>;
  scales: Record<string, number>;
  levels: { high: number; medium: number };
  anomalyConfig: { zThreshold: number; minSpikeExcess: number; testMonths: number; fuzzyNameThreshold: number; officerMinDecisions: number };
  ageBuckets: { label: string; min: number; max: number | null }[];
  stages: Record<string, string>;
  ai: { enabled: boolean; model: string | null };
}

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 5 * 60_000 });

/** Field actions in the caller's scope (shared by the Actions page, overview tile and create modal). */
export const useActions = () => useQuery({ queryKey: ['actions'], queryFn: () => api.get<ActionsResponse>('/actions') });
