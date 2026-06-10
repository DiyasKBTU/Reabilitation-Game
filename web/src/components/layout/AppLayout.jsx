import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import useAuthStore from '../../stores/authStore';
import useBleStore from '../../stores/bleStore';
import {
  GamepadIcon, TrophyIcon, UserIcon, StethoscopeIcon, SettingsIcon,
  ActivityIcon, LogOutIcon, BluetoothIcon,
} from '../icons';

const NAV_ALL = [
  { to: '/game', label: 'Игры', Icon: GamepadIcon },
  { to: '/device', label: 'Устройство', Icon: BluetoothIcon },
  { to: '/leaderboard', label: 'Рейтинг', Icon: TrophyIcon },
  { to: '/profile', label: 'Профиль', Icon: UserIcon },
];
const NAV_DOCTOR = [
  { to: '/doctor/patients', label: 'Пациенты', Icon: StethoscopeIcon },
];
const NAV_ADMIN = [
  { to: '/admin', label: 'Админ', Icon: SettingsIcon },
];

export default function AppLayout() {
  const { user, logout } = useAuthStore();
  // Селекторы, а не весь стор: иначе layout перерисовывался бы на каждое BLE-событие
  // (десятки раз в секунду при подключённом датчике) → лаги навигации.
  const connected = useBleStore((s) => s.connected);
  const status = useBleStore((s) => s.status);
  const navigate = useNavigate();

  const navItems = [
    ...NAV_ALL,
    ...(user?.role === 'doctor' || user?.role === 'admin' ? NAV_DOCTOR : []),
    ...(user?.role === 'admin' ? NAV_ADMIN : []),
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col w-16 md:w-56 bg-white border-r border-slate-200 shrink-0 print:hidden">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 md:px-4 py-5 border-b border-slate-100">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white shrink-0">
            <ActivityIcon size={18} />
          </span>
          <span className="hidden md:block font-bold text-slate-800 text-lg">RehabGame</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`
              }
              title={label}
            >
              <Icon size={19} className="shrink-0" />
              <span className="hidden md:block">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* BLE status → страница настройки устройства */}
        <div className="px-2 py-3 border-t border-slate-100">
          <button
            onClick={() => navigate('/device')}
            title="Настройка датчика"
            className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs transition-colors
              ${connected ? 'text-emerald-700 bg-emerald-50' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="hidden md:block truncate">{connected ? 'Датчик подключён' : status}</span>
          </button>
        </div>

        {/* User / logout */}
        <div className="px-2 py-3 border-t border-slate-100">
          <div className="hidden md:block px-2.5 py-1 text-xs text-slate-500 truncate">{user?.username}</div>
          <button
            onClick={handleLogout}
            title="Выйти"
            className="flex items-center gap-3 w-full px-2.5 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          >
            <LogOutIcon size={18} className="shrink-0" />
            <span className="hidden md:block">Выйти</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
