import NotificationsScreen from '../../components/NotificationsScreen';
import { useRole } from '../../hooks/useRole';

export default function AdminNotificationsScreen() {
  const { role } = useRole();
  return <NotificationsScreen role={role === 'finance' ? 'finance' : 'admin'} />;
}
