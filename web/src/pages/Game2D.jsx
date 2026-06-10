import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Game2DEngine } from '@game2d/index.js';
import { useBleStore, bleService } from '../stores/bleStore';
import useAuthStore from '../stores/authStore';
import useSessionStore from '../stores/sessionStore';
import { api } from '../api/index.js';
import BlePanel from '../components/BlePanel';
import GameIntro from '../components/GameIntro';

const CONTROLS = [
  { label: 'Платформа', keys: 'наклон кисти вбок · ← →' },
];

export default function Game2D() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { setLastSession } = useSessionStore();
  const { lastReading } = useBleStore();
  const [saving, setSaving] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new Game2DEngine(canvasRef.current, {
      alpha: 0.22,
      onGameOver: async (data) => {
        setSaving(true);
        try {
          const session = await api.createSession({
            score: data.score,
            max_combo: data.maxCombo,
            zone_hits: data.zoneHits,
            duration_sec: data.durationSec,
            level: data.level,
            game_type: data.gameType || 'game1',
            game_name: data.gameName || 'Space Catcher',
            imu_time_series: data.imuTimeSeries || [],
          });
          setLastSession(session);
          // replace: «назад» из результата ведёт к выбору игр, а не перезапускает игру
          navigate(`/session/${session.id}/result`, { replace: true });
        } catch (err) {
          console.error('Ошибка сохранения сессии:', err);
          navigate('/game');
        } finally {
          setSaving(false);
        }
      },
      onScore: () => {},
    });

    engineRef.current = engine;
    // Геймплей стартует по кнопке «Начать» (GameIntro), не на mount.

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Feed BLE data to engine
  useEffect(() => {
    const handler = (e) => {
      const s = e.detail?.smooth;
      if (s && engineRef.current) {
        engineRef.current.updateInput(s.roll ?? 0, s.pitch ?? 0, s.yaw ?? 0);
      }
    };
    bleService.addEventListener('data', handler);
    return () => bleService.removeEventListener('data', handler);
  }, []);

  function handleStart() {
    engineRef.current?.start();
    setStarted(true);
  }

  return (
    <div className="relative w-full h-full bg-slate-900 overflow-hidden">
      {!started && (
        <GameIntro
          title="Space Catcher"
          icon="🚀"
          color="from-blue-500 to-indigo-600"
          desc="Управляйте платформой движением кисти. Ловите шары, избегайте бомб."
          controls={CONTROLS}
          onStart={handleStart}
          onBack={() => navigate('/game')}
        />
      )}
      {saving && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
          <div className="text-white text-lg font-medium">Сохранение результатов...</div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{ touchAction: 'none', display: 'block' }}
      />

      {/* BLE panel overlay */}
      <div className="absolute top-3 right-3 z-10 w-48">
        <BlePanel />
      </div>

      {/* Back button */}
      <button
        onClick={() => navigate('/game')}
        className="absolute top-3 left-3 z-10 btn-secondary text-xs py-1"
      >
        ← Назад
      </button>
    </div>
  );
}
