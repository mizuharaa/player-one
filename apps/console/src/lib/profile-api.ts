import { useQuery } from '@tanstack/react-query';
import { ApiError } from './api.ts';

export interface OperatorProfile {
  operator: { id: string; external_ref: string; role: string; status: string; centre: { id: string; name: string; region: string } | null };
  activity: {
    timezone: 'Asia/Ho_Chi_Minh'; from: string; to: string;
    days: { date: string; count: number }[]; total_actions: number; active_days: number;
    scope: 'recorded_operator_actions';
  };
}

async function requestProfile(): Promise<OperatorProfile> {
  const response = await fetch('/api/operator/profile', { credentials: 'same-origin', signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null) as OperatorProfile | { error?: string; detail?: unknown; constraint?: string } | null;
  if (!response.ok) {
    const error = body as { error?: string; detail?: unknown; constraint?: string } | null;
    throw new ApiError(response.status, error?.error ?? response.statusText, error?.detail, error?.constraint, body);
  }
  if (!body || !('operator' in body) || !body.operator || !body.activity || !Array.isArray(body.activity.days)) {
    throw new ApiError(502, 'invalid_profile_response');
  }
  return body;
}

export function useOperatorProfile(enabled = true) {
  return useQuery({ queryKey: ['operator-profile'], queryFn: requestProfile, staleTime: 60_000, enabled, retry: false });
}

export async function signOut() {
  const response = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new ApiError(response.status, 'sign_out_failed');
}
