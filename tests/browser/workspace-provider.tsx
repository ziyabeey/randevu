import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../src/api';
import {
  WorkspaceProvider,
  type WorkspaceContextValue,
  type WorkspaceSession,
} from '../../src/workspace-context';

export default function BrowserWorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [error, setError] = useState('');

  const refreshSession = useCallback(async () => {
    const next = await api<WorkspaceSession>('/api/session');
    setSession(next);
    setError('');
    return next;
  }, []);

  const selectBusiness = useCallback(async (businessId: string) => {
    await api('/api/businesses/select', {
      method: 'POST',
      body: JSON.stringify({ businessId }),
    });
    const verified = await refreshSession();
    if (verified.activeBusinessId !== businessId) {
      throw new Error('Browser workspace fixture did not verify selected business.');
    }
    setScopeEpoch((value) => value + 1);
  }, [refreshSession]);

  useEffect(() => {
    void refreshSession().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : 'Browser workspace session failed.');
    });
  }, [refreshSession]);

  const activeMembership = session?.memberships.find(
    (membership) => membership.business_id === session.activeBusinessId,
  ) ?? null;

  const value = useMemo<WorkspaceContextValue | null>(() => {
    if (!session?.user || session.passwordRecovery || !activeMembership) return null;
    return {
      session,
      activeMembership,
      activeBusiness: activeMembership.businesses,
      activeBusinessId: activeMembership.business_id,
      scopeEpoch,
      refreshSession,
      selectBusiness,
    };
  }, [activeMembership, refreshSession, scopeEpoch, selectBusiness, session]);

  if (error) return <main role="alert">{error}</main>;
  if (!session) return <main aria-busy="true">İşletme ayarları hazırlanıyor…</main>;
  if (!session.user) return <main><h1>Önce giriş yapın</h1></main>;
  if (session.passwordRecovery) {
    return (
      <main>
        <h1>Önce yeni parolanızı belirleyin</h1>
        <p>Parolanızı güncelledikten sonra işletme alanını yeniden açın.</p>
      </main>
    );
  }
  if (!value) {
    return <main><h1>Önce çalışma alanını seçin.</h1></main>;
  }
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}
