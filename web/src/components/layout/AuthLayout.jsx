import { Outlet } from 'react-router-dom';
import { ActivityIcon } from '../icons';

export default function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white mb-3 shadow-sm">
            <ActivityIcon size={30} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">RehabGame</h1>
          <p className="text-slate-500 text-sm mt-1">Реабилитационная платформа</p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
