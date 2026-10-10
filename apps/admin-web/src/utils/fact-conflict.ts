import axios from 'axios';

interface FactVersionConflictPayload {
  code?: string;
  current?: {
    versionNo?: number;
    updatedAt?: string;
    updatedBy?: string;
  };
}

export interface FactVersionConflict {
  versionNo?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export function getFactVersionConflict(error: unknown): FactVersionConflict | undefined {
  if (!axios.isAxiosError<FactVersionConflictPayload>(error) || error.response?.status !== 409) return undefined;
  const payload = error.response.data;
  if (payload?.code !== 'FACT_VERSION_CONFLICT') return undefined;
  return payload.current;
}
