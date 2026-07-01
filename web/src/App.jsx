import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './stores/authStore';

import AppLayout from './components/layout/AppLayout';
import AuthLayout from './components/layout/AuthLayout';

import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import RegisterDoctor from './pages/RegisterDoctor';
import GameSelect from './pages/GameSelect';
import Calibration from './pages/Calibration';
import Game2D from './pages/Game2D';
import SessionResult from './pages/SessionResult';
import Dashboard from './pages/Dashboard';
import PatientList from './pages/PatientList';
import PatientDetail from './pages/PatientDetail';
import Leaderboard from './pages/Leaderboard';
import Profile from './pages/Profile';
import DeviceSetup from './pages/DeviceSetup';
import Admin from './pages/Admin';

// Game3D тянет Three.js (~150KB) — грузим лениво, чтобы не раздувать стартовый бандл
const Game3D = lazy(() => import('./pages/Game3D'));

function GameLoading() {
  return (
    <div className="flex items-center justify-center h-full bg-slate-900 text-slate-300">
      <div className="text-center">
        <div className="w-8 h-8 mb-3 mx-auto border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
        <div className="text-sm">Загрузка 3D-движка...</div>
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { token } = useAuthStore();
  return token ? children : <Navigate to="/login" replace />;
}

function RequireDoctor({ children }) {
  const { user } = useAuthStore();
  return user?.role === 'doctor' || user?.role === 'admin' ? children : <Navigate to="/game" replace />;
}

function RequireAdmin({ children }) {
  const { user } = useAuthStore();
  return user?.role === 'admin' ? children : <Navigate to="/game" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Публичная главная страница */}
        <Route path="/" element={<Landing />} />

        {/* Auth */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register-doctor" element={<RegisterDoctor />} />
        </Route>

        {/* App */}
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/game" element={<GameSelect />} />
          <Route path="/calibrate" element={<Calibration />} />
          <Route path="/game/2d" element={<Game2D />} />
          <Route path="/game/3d" element={<Suspense fallback={<GameLoading />}><Game3D /></Suspense>} />
          <Route path="/session/:id/result" element={<SessionResult />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/device" element={<DeviceSetup />} />

          <Route path="/doctor" element={<RequireDoctor><Dashboard /></RequireDoctor>} />
          <Route path="/doctor/patients" element={<RequireDoctor><PatientList /></RequireDoctor>} />
          <Route path="/doctor/patient/:id" element={<RequireDoctor><PatientDetail /></RequireDoctor>} />

          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        </Route>

        {/* Fallback → главная */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
