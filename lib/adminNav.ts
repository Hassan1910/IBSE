import type { LucideIcon } from 'lucide-react-native';
import {
  ShieldCheck,
  Home,
  Users,
  Package,
  LayoutGrid,
  FileBarChart,
  Wallet,
  MessageSquare,
  ScrollText,
  Settings,
  DatabaseBackup,
  GraduationCap,
  User,
} from 'lucide-react-native';

export type AdminNavSection = 'operations' | 'management' | 'system' | 'account';

export interface AdminNavItem {
  name: string;
  label: string;
  title: string;
  icon: LucideIcon;
  section: AdminNavSection;
  /** When false, finance staff cannot see or access via sidebar. Defaults to true. */
  financeAllowed?: boolean;
  /** When true, only full admins (not finance) can access. */
  adminOnly?: boolean;
}

export const ADMIN_NAV_SECTIONS: { key: AdminNavSection; label: string }[] = [
  { key: 'operations', label: 'Operations' },
  { key: 'management', label: 'Management' },
  { key: 'system', label: 'System' },
  { key: 'account', label: 'Account' },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    name: 'dashboard',
    label: 'Dashboard',
    title: 'Operations Hub',
    icon: ShieldCheck,
    section: 'operations',
  },
  {
    name: 'properties',
    label: 'Properties',
    title: 'Manage Properties',
    icon: Home,
    section: 'management',
    adminOnly: true,
  },
  {
    name: 'users',
    label: 'Users & Leases',
    title: 'Manage Users & Leases',
    icon: Users,
    section: 'management',
    adminOnly: true,
  },
  {
    name: 'inventory',
    label: 'Inventory',
    title: 'Manage Inventory',
    icon: Package,
    section: 'management',
    adminOnly: true,
  },
  {
    name: 'system',
    label: 'Admin Tools',
    title: 'Admin Tools',
    icon: LayoutGrid,
    section: 'system',
    adminOnly: true,
  },
  {
    name: 'reports',
    label: 'Reports',
    title: 'Report Generation',
    icon: FileBarChart,
    section: 'system',
  },
  {
    name: 'finances',
    label: 'Finances',
    title: 'Financial Oversight',
    icon: Wallet,
    section: 'system',
  },
  {
    name: 'support',
    label: 'Support',
    title: 'Feedback & Support',
    icon: MessageSquare,
    section: 'system',
    adminOnly: true,
  },
  {
    name: 'audit',
    label: 'Audit',
    title: 'Monitoring & Auditing',
    icon: ScrollText,
    section: 'system',
    adminOnly: true,
  },
  {
    name: 'settings',
    label: 'Settings',
    title: 'System Configuration',
    icon: Settings,
    section: 'system',
    adminOnly: true,
  },
  {
    name: 'backup',
    label: 'Snapshots',
    title: 'Integrity Snapshots',
    icon: DatabaseBackup,
    section: 'system',
    adminOnly: true,
  },
  {
    name: 'training',
    label: 'Training',
    title: 'Training & Support',
    icon: GraduationCap,
    section: 'system',
    adminOnly: true,
  },
  {
    name: 'profile',
    label: 'Profile',
    title: 'My Profile',
    icon: User,
    section: 'account',
  },
];

export function getNavItemsForRole(isFinance: boolean): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => {
    if (isFinance && item.adminOnly) return false;
    if (isFinance && item.financeAllowed === false) return false;
    return true;
  });
}

export function getNavItemByName(name: string): AdminNavItem | undefined {
  return ADMIN_NAV_ITEMS.find((item) => item.name === name);
}
