import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

export function PayoutEnvironment() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['payout-environment'], queryFn: async () => {
    const response = await fetch('/api/payout/environment', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('payout_environment_unavailable');
    return await response.json() as { environment: string };
  } });
  const environment = status.data?.environment;
  return <header className="workspace-route-counters" role="status">
    {t(environment === 'sandbox' ? 'settle.environment.sandbox' : environment === 'production' ? 'settle.environment.production' : 'settle.environment.unknown')}
  </header>;
}
