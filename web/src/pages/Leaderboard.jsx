import { useEffect, useState } from 'react';
import { api } from '../api/index.js';

export default function Leaderboard() {
  const [scores, setScores] = useState([]);
  const [gameType, setGameType] = useState('game1');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);   // повтор загрузки после ошибки API

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getLeaderboard(gameType)
      .then(setScores)
      // Раньше ошибка API глушилась в пустой catch → таблица показывала «нет результатов»
      // (неотличимо от реального отсутствия очков). Теперь честно показываем сбой + повтор.
      .catch((e) => setError(e.message || 'Не удалось загрузить рейтинг'))
      .finally(() => setLoading(false));
  }, [gameType, reloadKey]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Рейтинг</h1>
        <div className="flex gap-2">
          {[['game1', 'Space Catcher'], ['game2', 'City Driver']].map(([g, label]) => (
            <button
              key={g}
              onClick={() => setGameType(g)}
              className={`btn text-xs py-1 px-3 ${gameType === g ? 'btn-primary' : 'btn-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-center py-12">Загрузка...</div>
      ) : error ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-slate-600 mb-4">{error}</div>
          <button onClick={() => setReloadKey((k) => k + 1)} className="btn-secondary text-sm px-4 py-1.5">
            Повторить
          </button>
        </div>
      ) : scores.length === 0 ? (
        <div className="text-slate-400 text-center py-12">
          <div className="text-4xl mb-3">🏆</div>
          <div>Пока нет результатов. Сыграйте первым!</div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {scores.map((s, i) => (
            <div
              key={`${s.rank}-${s.created_at}`}
              className={`flex items-center px-4 py-3 border-b border-slate-50 last:border-0
                ${s.is_me ? 'bg-blue-50' : i === 0 ? 'bg-yellow-50' : i === 1 ? 'bg-slate-50' : ''}`}
            >
              <div className="w-8 text-center font-bold text-lg text-slate-400">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : s.rank}
              </div>
              <div className="flex-1 ml-3">
                <div className="font-semibold text-slate-800">
                  {s.display_name}
                  {s.is_me && <span className="ml-2 text-xs font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">это вы</span>}
                </div>
                <div className="text-xs text-slate-400">{new Date(s.created_at).toLocaleDateString('ru')}</div>
              </div>
              <div className="text-xl font-bold text-blue-600">{s.score.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
