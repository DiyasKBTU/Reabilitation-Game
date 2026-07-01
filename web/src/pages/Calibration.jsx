import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useBleStore, { bleService } from '../stores/bleStore';
import { api } from '../api/index.js';
import {
  TargetIcon, BluetoothIcon, CheckCircleIcon, ArrowLeftIcon, ChevronRightIcon,
  GaugeIcon, TimerIcon,
} from '../components/icons';

const DISPLAY_DEG = 45;      // ±диапазон шкалы 2D-поля (клампим угол к нему), °
const REACH_MIN = 6;         // насколько надо отклониться, чтобы направление засчиталось, °
const SAMPLE_MS = 40;        // ~25 Гц записи ряда (как у модели)
const N_TARGETS = 5;         // число мишеней в упражнении на точность
const HIT_RADIUS = 9;        // радиус попадания, % от поля

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angToPct = (a) => 50 + clamp(a / DISPLAY_DEG, -1, 1) * 50;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export default function Calibration() {
  const navigate = useNavigate();
  const connected = useBleStore((s) => s.connected);
  const lastReading = useBleStore((s) => s.lastReading);
  // calib — угол относительно нейтрали (zeroNow), НЕсглаженный: полный размах + этот же поток
  // (calib) пишется в imu_time_series и обнуляется и для датчика, и для клавиатуры.
  const roll = lastReading?.calib?.roll ?? 0;
  const pitch = lastReading?.calib?.pitch ?? 0;

  const [step, setStep] = useState('intro');   // intro | rom | targets | saving | done | error
  const [box, setBox] = useState({ rMin: 0, rMax: 0, pMin: 0, pMax: 0 });
  const [target, setTarget] = useState(null);  // {x, y, shownAt}
  const [tIndex, setTIndex] = useState(0);
  const [hits, setHits] = useState(0);
  const [times, setTimes] = useState([]);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const rollRef = useRef(0); rollRef.current = roll;
  const pitchRef = useRef(0); pitchRef.current = pitch;
  const recordingRef = useRef(false);
  const samplesRef = useRef([]);
  const startRef = useRef(0);
  const targetsRef = useRef([]);
  const hitLockRef = useRef(-1);   // индекс последней засчитанной мишени (защита от двойного попадания)

  // Запись сырого ряда (calib) фиксированным шагом во время измерения.
  useEffect(() => {
    const iv = setInterval(() => {
      if (!recordingRef.current) return;
      samplesRef.current.push({ t: Date.now() - startRef.current, r: rollRef.current, p: pitchRef.current });
    }, SAMPLE_MS);
    return () => clearInterval(iv);
  }, []);

  // Этап ROM: копим габаритную рамку достижимых углов по обеим осям.
  useEffect(() => {
    if (step !== 'rom') return;
    setBox((b) => ({
      rMin: Math.min(b.rMin, roll), rMax: Math.max(b.rMax, roll),
      pMin: Math.min(b.pMin, pitch), pMax: Math.max(b.pMax, pitch),
    }));
  }, [roll, pitch, step]);

  const cx = angToPct(roll), cy = angToPct(pitch);

  // Этап «мишени»: попадание = курсор в радиусе цели. Время до цели = реакция+движение.
  useEffect(() => {
    if (step !== 'targets' || !target) return;
    if (hitLockRef.current === tIndex) return;
    if (Math.hypot(cx - target.x, cy - target.y) <= HIT_RADIUS) {
      hitLockRef.current = tIndex;
      setHits((h) => h + 1);
      setTimes((arr) => [...arr, Date.now() - target.shownAt]);
      const next = tIndex + 1;
      if (next < targetsRef.current.length) {
        setTIndex(next);
        setTarget({ ...targetsRef.current[next], shownAt: Date.now() });
      } else {
        finish();
      }
    }
  }, [cx, cy, step, target, tIndex]);

  function startRom() {
    bleService.zeroNow?.();
    samplesRef.current = []; startRef.current = Date.now();
    setBox({ rMin: 0, rMax: 0, pMin: 0, pMax: 0 });
    recordingRef.current = true;
    setStep('rom');
  }

  function startTargets() {
    // Мишени в пределах ИЗМЕРЕННОГО диапазона (ужатого к центру на 18%, чтобы все были достижимы).
    const x0 = angToPct(box.rMin), x1 = angToPct(box.rMax);
    const y0 = angToPct(box.pMin), y1 = angToPct(box.pMax);
    const shrink = (a, b, k = 0.18) => [a + (b - a) * k, b - (b - a) * k];
    const [xa, xb] = shrink(x0, x1), [ya, yb] = shrink(y0, y1);
    const rnd = (a, b) => a + Math.random() * (b - a);
    targetsRef.current = Array.from({ length: N_TARGETS }, () => ({
      x: clamp(rnd(xa, xb), 8, 92), y: clamp(rnd(ya, yb), 8, 92),
    }));
    hitLockRef.current = -1;
    setHits(0); setTimes([]); setTIndex(0);
    setTarget({ ...targetsRef.current[0], shownAt: Date.now() });
    setStep('targets');
  }

  async function finish() {
    recordingRef.current = false;
    const samples = samplesRef.current;
    const metrics = {
      rollMin: Math.round(box.rMin * 10) / 10, rollMax: Math.round(box.rMax * 10) / 10,
      rollRom: Math.round((box.rMax - box.rMin) * 10) / 10,
      pitchMin: Math.round(box.pMin * 10) / 10, pitchMax: Math.round(box.pMax * 10) / 10,
      pitchRom: Math.round((box.pMax - box.pMin) * 10) / 10,
      targets: { total: N_TARGETS, hit: hits + 1, avgMs: Math.round(avg([...times, target ? Date.now() - target.shownAt : 0])) },
    };
    setResult(metrics);
    setStep('saving');
    try {
      await api.createSession({
        game_type: 'game1', game_name: 'Калибровка',
        duration_sec: samples.length ? samples[samples.length - 1].t / 1000 : 0,
        score: 0, level: 1, is_calibration: true,
        calibration: metrics, imu_time_series: samples,
      });
      setStep('done');
    } catch (e) {
      setErr(e.message || 'Не удалось сохранить калибровку'); setStep('error');
    }
  }

  const reached = {
    left: box.rMin <= -REACH_MIN, right: box.rMax >= REACH_MIN,
    up: box.pMin <= -REACH_MIN, down: box.pMax >= REACH_MIN,
  };
  const romDone = reached.left && reached.right && reached.up && reached.down;

  return (
    <div className="p-6 max-w-xl mx-auto">
      <button onClick={() => navigate('/game')}
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-700 mb-4">
        <ArrowLeftIcon size={15} /> К играм
      </button>

      <div className="flex items-center gap-3 mb-1">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white">
          <TargetIcon size={22} />
        </span>
        <h1 className="text-2xl font-bold text-slate-800">Калибровка движения</h1>
      </div>
      <p className="text-slate-500 text-sm mb-5">
        Измерим диапазон по двум осям и точность наведения — это персональная точка отсчёта.
      </p>

      <div className={`mb-5 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full
        ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
        <BluetoothIcon size={14} />
        {connected ? 'Датчик подключён' : 'Без датчика — стрелки ← → (наклон) и ↑ ↓ (вперёд/назад)'}
      </div>

      {/* Шаги */}
      {step !== 'intro' && step !== 'done' && step !== 'error' && (
        <div className="flex items-center gap-2 mb-4 text-xs font-medium">
          <Stepchip active={step === 'rom'} done={step === 'targets' || step === 'saving'} n="1" label="Диапазон" />
          <div className="h-px flex-1 bg-slate-200" />
          <Stepchip active={step === 'targets' || step === 'saving'} n="2" label="Точность" />
        </div>
      )}

      {/* ─── Интро ─── */}
      {step === 'intro' && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-800 mb-3">Два коротких задания</h2>
          <ol className="space-y-3 text-sm text-slate-600">
            <li className="flex gap-3"><Num n={1} /> <span><b>Диапазон.</b> Подвигайте кистью во все стороны до упора — влево, вправо, вперёд, назад.</span></li>
            <li className="flex gap-3"><Num n={2} /> <span><b>Точность.</b> Наводите курсор на мишени, которые появляются на поле. Замерим время и попадания.</span></li>
          </ol>
          <p className="text-xs text-slate-400 mt-4">Двигайтесь спокойно, без боли. Управление — кистью или стрелками на клавиатуре.</p>
          <button onClick={startRom} className="btn-primary w-full mt-5 py-2.5">Начать <ChevronRightIcon size={18} /></button>
        </div>
      )}

      {/* ─── Этап 1: ROM по двум осям ─── */}
      {step === 'rom' && (
        <div className="card p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Диапазон движения</h2>
          <p className="text-sm text-slate-500 mb-4">Дотянитесь во все четыре стороны до упора.</p>

          <Pad cx={cx} cy={cy}
            boxRect={{ x: angToPct(box.rMin), y: angToPct(box.pMin), w: angToPct(box.rMax) - angToPct(box.rMin), h: angToPct(box.pMax) - angToPct(box.pMin) }} />

          <div className="grid grid-cols-4 gap-2 mt-4">
            <Dir ok={reached.left} label="Влево" val={box.rMin} />
            <Dir ok={reached.right} label="Вправо" val={box.rMax} />
            <Dir ok={reached.up} label="Вперёд" val={box.pMin} />
            <Dir ok={reached.down} label="Назад" val={box.pMax} />
          </div>

          <button onClick={startTargets} disabled={!romDone} className="btn-primary w-full mt-5 py-2.5">
            {romDone ? <>К точности <ChevronRightIcon size={18} /></> : 'Дотянитесь во все стороны'}
          </button>
        </div>
      )}

      {/* ─── Этап 2: мишени ─── */}
      {step === 'targets' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-slate-800">Наведение на цель</h2>
            <span className="text-sm text-slate-400">Цель {Math.min(tIndex + 1, N_TARGETS)} из {N_TARGETS}</span>
          </div>
          <p className="text-sm text-slate-500 mb-4">Наведите курсор на мишень — она сменится следующей.</p>

          <Pad cx={cx} cy={cy} target={target} />

          <div className="grid grid-cols-2 gap-3 mt-4">
            <Stat label="Попаданий" value={`${hits}/${N_TARGETS}`} />
            <Stat label="Среднее время" value={times.length ? `${(avg(times) / 1000).toFixed(1)}с` : '—'} />
          </div>
        </div>
      )}

      {/* ─── Сохранение ─── */}
      {step === 'saving' && (
        <div className="card p-8 text-center text-slate-500">
          <div className="w-8 h-8 mb-3 mx-auto border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          Сохраняем калибровку…
        </div>
      )}

      {/* ─── Готово ─── */}
      {step === 'done' && result && (
        <div className="card p-6 text-center">
          <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 mb-3">
            <CheckCircleIcon size={30} />
          </span>
          <h2 className="text-xl font-bold text-slate-800 mb-1">Калибровка выполнена</h2>
          <p className="text-sm text-slate-500 mb-5">Персональный профиль движения сохранён.</p>

          <div className="grid grid-cols-2 gap-3 mb-3 text-left">
            <Metric Icon={GaugeIcon} label="Диапазон вбок (roll)" value={`${result.rollRom.toFixed(0)}°`} sub={`${result.rollMin.toFixed(0)}…${result.rollMax.toFixed(0)}°`} />
            <Metric Icon={GaugeIcon} label="Диапазон вперёд/назад (pitch)" value={`${result.pitchRom.toFixed(0)}°`} sub={`${result.pitchMin.toFixed(0)}…${result.pitchMax.toFixed(0)}°`} />
            <Metric Icon={TargetIcon} label="Точность" value={`${result.targets.hit}/${result.targets.total}`} />
            <Metric Icon={TimerIcon} label="Среднее время до цели" value={`${(result.targets.avgMs / 1000).toFixed(1)}с`} />
          </div>

          <div className="flex gap-3 mt-5">
            <button onClick={() => navigate('/game')} className="btn-primary flex-1">К играм</button>
            <button onClick={() => setStep('intro')} className="btn-secondary flex-1">Заново</button>
          </div>
        </div>
      )}

      {step === 'error' && (
        <div className="card p-6 text-center">
          <p className="text-slate-700 font-medium mb-1">Не удалось сохранить калибровку</p>
          <p className="text-sm text-slate-400 mb-4">{err}</p>
          <button onClick={() => setStep('intro')} className="btn-primary">Попробовать снова</button>
        </div>
      )}
    </div>
  );
}

// 2D-поле: курсор (синий), мишень (кольцо) и/или габаритная рамка достижимого диапазона.
function Pad({ cx, cy, target = null, boxRect = null }) {
  return (
    <div className="relative w-full max-w-sm mx-auto aspect-square rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
      {/* перекрестие центра */}
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-200" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
      {boxRect && boxRect.w > 0 && boxRect.h > 0 && (
        <div className="absolute rounded-lg border-2 border-blue-300 bg-blue-200/20"
          style={{ left: `${boxRect.x}%`, top: `${boxRect.y}%`, width: `${boxRect.w}%`, height: `${boxRect.h}%` }} />
      )}
      {target && (
        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${target.x}%`, top: `${target.y}%` }}>
          <span className="block w-7 h-7 rounded-full border-2 border-amber-500 bg-amber-400/30 animate-pulse" />
        </div>
      )}
      <div className="absolute w-4 h-4 rounded-full bg-blue-600 shadow -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75"
        style={{ left: `${cx}%`, top: `${cy}%` }} />
    </div>
  );
}

function Stepchip({ active, done, n, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
      ${active ? 'bg-blue-600 text-white' : done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
      <span className="w-4 h-4 rounded-full bg-white/30 inline-flex items-center justify-center text-[10px]">{done ? '✓' : n}</span>
      {label}
    </span>
  );
}

function Num({ n }) {
  return <span className="flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-blue-50 text-blue-600 text-xs font-bold">{n}</span>;
}

function Dir({ ok, label, val }) {
  return (
    <div className={`rounded-xl border p-2 text-center ${ok ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${ok ? 'text-emerald-600' : 'text-slate-700'}`}>{Math.abs(val).toFixed(0)}°</div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-bold text-blue-600 tabular-nums">{value}</div>
    </div>
  );
}

function Metric({ Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-400"><Icon size={13} /> {label}</div>
      <div className="text-xl font-bold text-slate-800 tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
