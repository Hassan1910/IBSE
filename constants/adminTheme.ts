export const adminTheme = {
  colors: {
    bg: '#0F172A',
    surface: '#1E293B',
    surfaceElevated: '#243044',
    border: '#334155',
    accent: '#38BDF8',
    accentMuted: 'rgba(56, 189, 248, 0.1)',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    textDim: '#64748B',
    danger: '#EF4444',
    dangerMuted: 'rgba(239, 68, 68, 0.1)',
    success: '#10B981',
    warning: '#EAB308',
    onAccent: '#0F172A',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    full: 999,
  },
  sidebar: {
    width: 280,
  },
  typography: {
    title: { fontSize: 20, fontWeight: '700' as const },
    subtitle: { fontSize: 16, fontWeight: '600' as const },
    body: { fontSize: 14, fontWeight: '400' as const },
    caption: { fontSize: 12, fontWeight: '500' as const },
    label: { fontSize: 11, fontWeight: '600' as const },
  },
} as const;

export type AdminTheme = typeof adminTheme;
