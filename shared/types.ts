export type Role = 'owner' | 'manager' | 'staff';

export type Business = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
};

export type Membership = {
  id: string;
  business_id: string;
  role: Role;
  active: boolean;
  businesses?: Business | null;
};

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string | null;
};

export type Session = {
  user: SessionUser | null;
  memberships: Membership[];
  activeBusinessId: string | null;
  passwordRecovery: boolean;
  csrfToken: string;
};

export type PriceType = 'fixed' | 'range';

export type ManagedService = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  category?: string;
  sort_order?: number;
  price_minor: number;
  price_type?: PriceType;
  price_min_minor?: number;
  price_max_minor?: number;
  price_policy_version?: number;
  currency: string;
  active: boolean;
  updated_at?: string;
};

export type ManagedStaff = {
  id: string;
  membership_id: string | null;
  name: string;
  phone: string | null;
  active: boolean;
  updated_at?: string;
};

export type ManagedAssignment = {
  staff_id: string;
  service_id: string;
  active: boolean;
  updated_at?: string;
};

export type ManagedCatalog = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  services: ManagedService[];
  staff: ManagedStaff[];
  assignments: ManagedAssignment[];
};
