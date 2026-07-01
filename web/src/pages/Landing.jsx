import { Link } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import {
  ActivityIcon, BluetoothIcon, GamepadIcon, BrainIcon, StethoscopeIcon,
  HeartPulseIcon, ShieldIcon, TrendingUpIcon, CheckCircleIcon, TargetIcon,
  ChevronRightIcon, AxisIcon,
} from '../components/icons';

// Куда ведёт основной CTA: если уже вошёл — в приложение по роли, иначе на регистрацию.
function appHomeFor(user) {
  if (!user) return '/register';
  if (user.role === 'admin') return '/admin';
  if (user.role === 'doctor') return '/doctor';
  return '/game';
}

function Step({ Icon, n, title, text }) {
  return (
    <div className="relative card p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 text-blue-600">
          <Icon size={22} />
        </span>
        <span className="text-xs font-semibold text-slate-400">Шаг {n}</span>
      </div>
      <h3 className="font-semibold text-slate-800 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed">{text}</p>
    </div>
  );
}

function Metric({ label, value, sub, accent = 'text-slate-800' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function Landing() {
  const { user } = useAuthStore();
  const ctaTo = appHomeFor(user);
  const ctaLabel = user ? 'Открыть приложение' : 'Начать';

  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* ─── Шапка ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white">
              <AxisIcon size={20} />
            </span>
            <span className="font-bold text-lg">Axis</span>
          </div>
          <nav className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <Link to={ctaTo} className="btn-primary px-4 py-2 text-sm">Открыть приложение</Link>
            ) : (
              <>
                <Link to="/login" className="btn-secondary px-4 py-2 text-sm">Войти</Link>
                <Link to="/register" className="btn-primary px-4 py-2 text-sm">Регистрация</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* ─── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-slate-50" aria-hidden="true" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 mb-5">
              <HeartPulseIcon size={14} />
              Реабилитация детей с ДЦП
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.1]">
              Реабилитация движением —<br className="hidden sm:block" /> в форме игры
            </h1>
            <p className="mt-5 text-lg text-slate-500 leading-relaxed max-w-xl">
              Ребёнок управляет игрой движением кисти через носимый датчик.
              Врач получает объективную аналитику моторики — амплитуду, плавность,
              тремор — и видит динамику от занятия к занятию.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={ctaTo} className="btn-primary px-6 py-3 text-base">
                {ctaLabel} <ChevronRightIcon size={18} />
              </Link>
              <Link to="/login" className="btn-secondary px-6 py-3 text-base">Войти</Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5"><CheckCircleIcon size={16} className="text-emerald-500" /> Без установки приложений</span>
              <span className="inline-flex items-center gap-1.5"><ShieldIcon size={16} className="text-emerald-500" /> Данные под защитой</span>
            </div>
          </div>

          {/* Превью врачебной панели — «что увидит врач» */}
          <div className="relative">
            <div className="card p-5 shadow-lg shadow-slate-200/60">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600">
                    <StethoscopeIcon size={18} />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Карточка пациента</div>
                    <div className="text-xs text-slate-400">Space Catcher · сессия 12</div>
                  </div>
                </div>
                <span className="badge-normal">норма</span>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <Metric label="Амплитуда" value="67°" sub="старт 45°" accent="text-blue-600" />
                <Metric label="Плавность" value="0.91" sub="+0.06" accent="text-emerald-600" />
                <Metric label="Тремор" value="0.04" sub="низкий" />
              </div>

              {/* Мини-график прогресса */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-500">Динамика амплитуды</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                    <TrendingUpIcon size={14} /> +49%
                  </span>
                </div>
                <div className="flex items-end gap-1.5 h-16">
                  {[40, 44, 43, 50, 55, 53, 60, 64, 62, 67].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t bg-blue-500/80"
                      style={{ height: `${(h / 67) * 100}%` }} />
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50/70 px-3 py-2">
                <BrainIcon size={16} className="text-blue-600 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-600 leading-relaxed">
                  ML-оценка: движения в пределах персональной нормы, устойчивый рост амплитуды.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Как это работает ──────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl font-bold text-slate-900">Как это работает</h2>
          <p className="mt-3 text-slate-500">
            Три простых шага — от движения руки до клинической аналитики.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          <Step Icon={BluetoothIcon} n="1" title="Носимый датчик"
            text="Лёгкий датчик на кисти передаёт движение по Bluetooth прямо в браузер — без проводов и установки программ." />
          <Step Icon={GamepadIcon} n="2" title="Игра как тренировка"
            text="Ребёнок наклоном кисти управляет игрой. Полезное движение превращается в увлекательное занятие." />
          <Step Icon={BrainIcon} n="3" title="Аналитика для врача"
            text="Каждое занятие анализируется: амплитуда, плавность, тремор, паузы. Врач видит прогресс и отклонения." />
        </div>
      </section>

      {/* ─── Для кого ──────────────────────────────────────────────────── */}
      <section className="bg-slate-50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-bold text-slate-900">Для детей с ДЦП</h2>
            <p className="mt-4 text-slate-500 leading-relaxed">
              Платформа создана для тренировки крупной моторики руки у детей с детским
              церебральным параличом. Регулярные игровые занятия поддерживают мотивацию,
              а объективные измерения помогают врачу видеть реальную картину — без
              субъективных оценок «на глаз».
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Персональная калибровка: точка старта фиксируется индивидуально',
                'Прогресс считается относительно собственной нормы ребёнка',
                'Понятные отчёты для врача и родителей',
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-slate-600">
                  <CheckCircleIcon size={18} className="text-emerald-500 mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { Icon: TargetIcon, t: 'Амплитуда (ROM)', d: 'Диапазон движения сустава в градусах' },
              { Icon: ActivityIcon, t: 'Плавность', d: 'Насколько движение ровное, без рывков' },
              { Icon: HeartPulseIcon, t: 'Тремор', d: 'Дрожание — маркер усталости и неврологии' },
              { Icon: TrendingUpIcon, t: 'Динамика', d: 'Тренд от занятия к занятию' },
            ].map(({ Icon, t, d }) => (
              <div key={t} className="card p-5">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 text-blue-600 mb-3">
                  <Icon size={20} />
                </span>
                <div className="font-semibold text-slate-800 text-sm">{t}</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ───────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="relative overflow-hidden rounded-2xl bg-blue-600 px-6 sm:px-12 py-12 text-center">
          <h2 className="text-3xl font-bold text-white">Готовы попробовать?</h2>
          <p className="mt-3 text-blue-100 max-w-xl mx-auto">
            Зарегистрируйтесь как пациент или войдите как врач, чтобы увидеть аналитику в действии.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to={ctaTo} className="btn px-6 py-3 text-base bg-white text-blue-700 hover:bg-blue-50">
              {ctaLabel}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Подвал ────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-500">
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 text-white">
              <AxisIcon size={16} />
            </span>
            <span className="text-sm font-medium text-slate-700">Axis</span>
          </div>
          <p className="text-xs text-slate-400">
            Реабилитационная платформа. Не является медицинским изделием; не заменяет консультацию врача.
          </p>
        </div>
      </footer>
    </div>
  );
}
