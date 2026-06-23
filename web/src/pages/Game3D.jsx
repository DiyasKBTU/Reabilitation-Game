import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Game3DEngine } from '@game3d/index.js';
import { bleService } from '../stores/bleStore';
import useSessionStore from '../stores/sessionStore';
import { api } from '../api/index.js';
import BlePanel from '../components/BlePanel';
import GameIntro from '../components/GameIntro';
import { GaugeIcon, AlertTriangleIcon } from '../components/icons';

const CONTROLS = [
  { label: 'Руль', keys: 'наклон вбок · ← →' },
  { label: 'Газ / тормоз', keys: 'наклон вперёд-назад · ↑ ↓' },
];

export default function Game3D() {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const romFillRef = useRef(null);
  const romLabelRef = useRef(null);
  const speedFillRef = useRef(null);
  const speedLabelRef = useRef(null);
  const navigate = useNavigate();
  const { setLastSession } = useSessionStore();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState({ score: 0, lives: 3, level: 1, combo: 0, challenge: '' });
  const pendingRef = useRef(null); // данные завершённой игры, ожидающие сохранения (для повтора)

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
        game_type: data.gameType || 'game2',
        game_name: data.gameName || 'City Driver',
        imu_time_series: data.imuTimeSeries || [],
      });
      setLastSession(session);
      // replace: убираем экран игры из истории → «назад» из результата ведёт к выбору игр
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
    const container = containerRef.current;
    if (!container) return;

    // StrictMode в dev выполняет эффект дважды (mount → cleanup → mount). Если
    // переиспользовать один и тот же canvas, второй mount падает: destroy() движка
    // вызывает forceContextLoss() и «отравляет» WebGL-контекст этого canvas. Поэтому
    // создаём свежий canvas внутри эффекта — у каждого mount свой контекст.
    const canvas = document.createElement('canvas');
    canvas.className = 'w-full h-full block';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    const engine = new Game3DEngine(canvas, {
      alpha: 0.2,
      onState: (s) => setHud({ score: s.score, lives: s.lives, level: s.level, combo: s.combo, challenge: s.challengeLabel }),
      onGameOver: (data) => saveSession(data),
    });

    engineRef.current = engine;
    // Движок строит сцену и крутит рендер-луп, но геймплей НЕ стартует —
    // ждём кнопку «Начать» на экране GameIntro (игрок успевает подготовиться).

    // ROM-бар обновляем императивно (без re-render React каждый кадр)
    let raf;
    const romLoop = () => {
      const roll = engineRef.current?.state.roll ?? 0;
      const norm = Math.max(-1, Math.min(1, roll / 45));
      const a = Math.abs(roll);
      if (romFillRef.current) {
        romFillRef.current.style.left = `calc(50% + ${norm * 50}% - 2px)`;
        romFillRef.current.style.background = a > 25 ? '#22c55e' : a > 10 ? '#f59e0b' : '#ef4444';
      }
      if (romLabelRef.current) romLabelRef.current.textContent = `Руль: ${roll.toFixed(1)}°`;
      // Скорость (ось pitch — газ/тормоз)
      const thr = engineRef.current?.state.throttle ?? 1;
      const pct = Math.max(0, Math.min(100, ((thr - 0.45) / (1.6 - 0.45)) * 100));
      if (speedFillRef.current) {
        speedFillRef.current.style.width = `${pct}%`;
        speedFillRef.current.style.background = thr > 1.1 ? '#22c55e' : thr < 0.9 ? '#ef4444' : '#38bdf8';
      }
      if (speedLabelRef.current) speedLabelRef.current.textContent = `Скорость: ${thr > 1.1 ? 'газ' : thr < 0.9 ? 'тормоз' : 'крейсер'}`;
      raf = requestAnimationFrame(romLoop);
    };
    romLoop();

    return () => {
      cancelAnimationFrame(raf);
      engine.destroy();
      engineRef.current = null;
      canvas.remove();
    };
  }, []);

  // Подаём BLE-данные в движок
  useEffect(() => {
    const handler = (e) => {
      const s = e.detail?.smooth;
      if (s && engineRef.current) {
        // smooth → управление; calib (несглаженный) → запись в ML-ряд (сохраняет тремор)
        engineRef.current.updateInput(s.roll ?? 0, s.pitch ?? 0, s.yaw ?? 0, e.detail.calib);
      }
    };
    bleService.addEventListener('data', handler);
    return () => bleService.removeEventListener('data', handler);
  }, []);

  const lives = '❤️'.repeat(Math.max(0, hud.lives)) + '🖤'.repeat(Math.max(0, 3 - hud.lives));

  function handleStart() {
    engineRef.current?.start();
    setStarted(true);
  }

  return (
    <div className="relative w-full h-full bg-slate-900 overflow-hidden">
      {!started && (
        <GameIntro
          title="City Driver"
          icon={GaugeIcon}
          color="from-emerald-500 to-teal-600"
          desc="3D-вождение с испытаниями: слалом, ворота, поток машин. Держите руль наклоном кисти, газуйте и тормозите наклоном вперёд-назад."
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

      <div ref={containerRef} className="absolute inset-0" />

      {/* HUD */}
      <div className="absolute top-3 left-3 z-10 bg-slate-900/70 backdrop-blur rounded-xl px-4 py-3 text-white min-w-[140px]">
        <div className="text-3xl font-bold text-blue-400 leading-none">{hud.score}</div>
        <div className="text-xs text-slate-300 mt-1.5">Уровень: {hud.level}</div>
        <div className="text-sm mt-1">{lives}</div>
        {hud.combo >= 2 && (
          <div className="text-sm font-bold text-orange-400 mt-1">COMBO ×{hud.combo}</div>
        )}
      </div>

      {/* Баннер текущего испытания */}
      {hud.challenge && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-blue-600/25 border border-blue-500/60 text-blue-200 text-sm font-semibold px-4 py-1.5 rounded-full whitespace-nowrap">
          {hud.challenge}
        </div>
      )}

      {/* BLE panel */}
      <div className="absolute top-3 right-3 z-10 w-48">
        <BlePanel />
      </div>

      {/* Back */}
      <button onClick={() => navigate('/game')} className="absolute bottom-3 left-3 z-10 btn-secondary text-xs py-1">
        ← Назад
      </button>

      {/* ROM steering bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-72">
        <div className="h-2.5 bg-white/10 rounded-full relative">
          <div ref={romFillRef} className="absolute top-0 bottom-0 w-1 rounded-full bg-green-500"
               style={{ left: '50%' }} />
        </div>
        <div ref={romLabelRef} className="text-center text-xs text-slate-300 mt-1">Руль: 0°</div>
        <div className="h-2 bg-white/10 rounded-full relative mt-2 overflow-hidden">
          <div ref={speedFillRef} className="absolute top-0 bottom-0 left-0 rounded-full bg-sky-400" style={{ width: '50%' }} />
        </div>
        <div ref={speedLabelRef} className="text-center text-xs text-slate-300 mt-1">Скорость: крейсер</div>
      </div>
    </div>
  );
}
