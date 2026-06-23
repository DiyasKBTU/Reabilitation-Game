import { useNavigate } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import { TargetIcon, GaugeIcon } from '../components/icons';

const GAMES = [
  {
    id: 'game1',
    name: 'Space Catcher',
    desc: 'Управляйте платформой движением кисти. Ловите шары, избегайте бомб.',
    icon: TargetIcon,
    color: 'from-blue-500 to-indigo-600',
    path: '/game/2d',
    tags: ['Ловкость', 'Координация', '2D'],
  },
  {
    id: 'game2',
    name: 'City Driver',
    desc: '3D-вождение с испытаниями: руль — наклон вбок (roll), газ и тормоз — наклон вперёд/назад (pitch). Слалом, ворота, поток машин.',
    icon: GaugeIcon,
    color: 'from-emerald-500 to-teal-600',
    path: '/game/3d',
    tags: ['Roll + Pitch', 'Испытания', '3D'],
  },
];

export default function GameSelect() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Игры</h1>
      <p className="text-slate-500 text-sm mb-6">Выберите упражнение для тренировки</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {GAMES.map((game) => {
          const Icon = game.icon;
          return (
          <button
            key={game.id}
            onClick={() => navigate(game.path)}
            className="card p-0 text-left hover:shadow-md transition-shadow overflow-hidden group"
          >
            <div className={`bg-gradient-to-br ${game.color} h-28 flex items-center justify-center`}>
              <Icon size={48} className="text-white group-hover:scale-110 transition-transform" />
            </div>
            <div className="p-4">
              <h3 className="font-bold text-slate-800 text-base">{game.name}</h3>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">{game.desc}</p>
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {game.tags.map((t) => (
                  <span key={t} className="badge-info">{t}</span>
                ))}
              </div>
            </div>
          </button>
          );
        })}
      </div>
    </div>
  );
}
