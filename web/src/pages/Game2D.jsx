import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Game2DEngine } from '@game2d/index.js';
import { useBleStore, bleService, resetInputStats, getInputSource } from '../stores/bleStore';
import useAuthStore from '../stores/authStore';
import useSessionStore from '../stores/sessionStore';
import { api } from '../api/index.js';
import BlePanel from '../components/BlePanel';
import GameIntro from '../components/GameIntro';
import { TargetIcon, AlertTriangleIcon } from '../components/icons';

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
  const [saveFailed, setSaveFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const pendingRef = useRef(null); // данные завершённой игры, ожидающие сохранения (для повтора)
  // Обрыв датчика во время игры: ребёнок должен сразу понять, что случилось и что делать
  // (клавиатурный fallback всегда активен — игра управляема, но об этом надо сказать).
  const [sensorLost, setSensorLost] = useState(false);
  const sensorUsedRef = useRef(false);  // в этой игре был вход с датчика (не только клавиатура)
  const startedRef = useRef(false);
  startedRef.current = started;

  // Сохранение результата с возможностью повтора: при сбое сети сессия НЕ теряется —
  // данные игры остаются в pendingRef, игрок видит ошибку и может повторить (а не молча уходит).
  async function saveSession(data) {
    setSaving(true);
    setSaveFailed(false);
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
        // Датчик или клавиатура: сервер по этому полю отделяет реальные движения кисти
        // от синтетики (клавиатурные сессии не идут в baseline, рейтинг и обучение).
        input_source: getInputSource(),
      });
      setLastSession(session);
      // replace: «назад» из результата ведёт к выбору игр, а не перезапускает игру
      navigate(`/session/${session.id}/result`, { replace: true });
    } catch (err) {
      console.error('Ошибка сохранения сессии:', err);
      pendingRef.current = data;
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new Game2DEngine(canvasRef.current, {
      alpha: 0.22,
      onGameOver: (data) => saveSession(data),
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
      // События реального датчика идут без source (клавиатурные помечены 'keyboard').
      if (!e.detail?.source) sensorUsedRef.current = true;
      const s = e.detail?.smooth;
      if (s && engineRef.current) {
        // smooth → управление; calib (несглаженный) → запись в ML-ряд (сохраняет тремор)
        engineRef.current.updateInput(s.roll ?? 0, s.pitch ?? 0, s.yaw ?? 0, e.detail.calib);
      }
    };
    bleService.addEventListener('data', handler);
    return () => bleService.removeEventListener('data', handler);
  }, []);

  // Обрыв BLE во время игры → заметный баннер (панель статуса справа слишком незаметна в игре).
  useEffect(() => {
    const onDrop = () => { if (startedRef.current && sensorUsedRef.current) setSensorLost(true); };
    const onBack = () => setSensorLost(false);
    bleService.addEventListener('disconnected', onDrop);
    bleService.addEventListener('connected', onBack);
    return () => {
      bleService.removeEventListener('disconnected', onDrop);
      bleService.removeEventListener('connected', onBack);
    };
  }, []);

  function handleStart() {
    resetInputStats();   // источник входа считаем с нуля для каждой игры
    engineRef.current?.start();
    setStarted(true);
  }

  return (
    <div className="relative w-full h-full bg-slate-900 overflow-hidden">
      {!started && (
        <GameIntro
          title="Space Catcher"
          icon={TargetIcon}
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
      {started && sensorLost && !saving && !saveFailed && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-2rem)] max-w-md">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg flex items-start gap-2.5">
            <AlertTriangleIcon size={18} className="shrink-0 mt-0.5" />
            <span>
              <b>Датчик отключился.</b> Игра продолжается на стрелках ← →. Переподключите
              датчик в панели справа — управление кистью вернётся автоматически.
            </span>
          </div>
        </div>
      )}
      {saveFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20 p-4">
          <div className="card p-6 max-w-sm text-center">
            <AlertTriangleIcon size={28} className="mx-auto mb-3 text-amber-500" />
            <p className="font-medium text-slate-800">Не удалось сохранить результат</p>
            <p className="text-sm text-slate-500 mt-1">Проверьте соединение — результат игры не потерян.</p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => navigate('/game')} className="btn-secondary flex-1">К играм</button>
              <button onClick={() => saveSession(pendingRef.current)} className="btn-primary flex-1">Повторить</button>
            </div>
          </div>
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
