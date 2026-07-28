export const queryKeys = {
  adminDashboardStats: ['admin', 'dashboard', 'stats'] as const,
  adminDashboardQueues: ['admin', 'dashboard', 'queues'] as const,
  adminReportSummary: (from?: string | null, to?: string | null) =>
    ['admin', 'reports', from ?? null, to ?? null] as const,
  adminFinances: ['admin', 'finances'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminProperties: ['admin', 'properties'] as const,
  adminSupport: ['admin', 'support'] as const,
  adminInventory: ['admin', 'inventory'] as const,
  availableProperties: (category: string) =>
    ['properties', 'available', category] as const,
  landlordDashboard: (userId: string) => ['landlord', 'dashboard', userId] as const,
  landlordProperties: (userId: string) =>
    ['landlord', 'properties', userId] as const,
  landlordPayments: (userId: string) =>
    ['landlord', 'payments', userId] as const,
  landlordMaintenance: (userId: string) =>
    ['landlord', 'maintenance', userId] as const,
  landlordTenants: (userId: string) => ['landlord', 'tenants', userId] as const,
  landlordAgreements: (userId: string) => ['landlord', 'agreements', userId] as const,
  tenantDashboard: (userId: string) => ['tenant', 'dashboard', userId] as const,
  tenantMaintenance: (userId: string) =>
    ['tenant', 'maintenance', userId] as const,
  tenantRent: (userId: string) => ['tenant', 'rent', userId] as const,
  tenantBalance: (leaseId: string) => ['tenant', 'balance', leaseId] as const,
  clientBookings: (userId: string) => ['client', 'bookings', userId] as const,
  clientPurchases: (userId: string) => ['client', 'purchases', userId] as const,
  clientDeposits: (userId: string) => ['client', 'deposits', userId] as const,
};
