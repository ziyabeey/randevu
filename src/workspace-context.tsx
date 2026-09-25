import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export type WorkspaceBusiness = { id: string; name: string; slug: string; timezone: string };
export type WorkspaceMembership = {
  id: string;
  business_id: string;
  role: 'owner' | 'manager' | 'staff';
  active: boolean;
  businesses: WorkspaceBusiness | null;
};
export type WorkspaceSession = {
  user: null | { id: string; email: string | null; fullName: string | null };
  memberships: WorkspaceMembership[];
  activeBusinessId: string | null;
  passwordRecovery: boolean;
  csrfToken: string;
};

export type WorkspaceContextValue = {
  session: WorkspaceSession;
  activeMembership: WorkspaceMembership;
  activeBusiness: WorkspaceBusiness | null;
  activeBusinessId: string;
  scopeEpoch: number;
  refreshSession(): Promise<WorkspaceSession>;
  selectBusiness(businessId: string, options?: { to?: string }): Promise<void>;
  // F16-08 account actions shared by the Randevu panel and SalonApp menus.
  account?: { openPasswordChange(): void; logout(): Promise<void> };
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceContextValue; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace context is not available on this route.');
  return value;
}
