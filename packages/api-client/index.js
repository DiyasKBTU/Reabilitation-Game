/**
 * packages/api-client — REST-клиент RehabGame
 *
 * Заменяет shared/api.js + shared/config.js.
 * ES-модуль, без зависимостей. Используется как в React так и в тестах.
 *
 * Использование:
 *   import { createApiClient } from '../../packages/api-client/index.js';
 *
 *   const api = createApiClient({
 *     baseUrl: 'http://localhost:5000',
 *     getToken: () => localStorage.getItem('token'),
 *     onUnauthorized: () => { ... redirect to login ... }
 *   });
 *
 *   const patients = await api.get('/api/patient');
 *   await api.post('/api/sessions', sessionBody);
 */

/**
 * Автоматически определяет baseUrl по текущему origin.
 * localhost → http://localhost:5000
 * всё остальное → https://api.rehabgame.example (поменяй при деплое)
 */
export function detectBaseUrl() {
  if (typeof window === "undefined") return "http://localhost:5000";
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  return isLocal ? "http://localhost:5000" : "https://api.rehabgame.example";
}

/**
 * Фабрика API-клиента.
 * @param {object} options
 * @param {string}   options.baseUrl       - базовый URL бэкенда
 * @param {function} options.getToken      - () => string | null — возвращает JWT
 * @param {function} options.onUnauthorized - вызывается при 401 (по умолч. — ничего)
 */
export function createApiClient({
  baseUrl = detectBaseUrl(),
  getToken = () => null,
  onUnauthorized = () => {}
} = {}) {

  async function request(path, { method = "GET", body, skipAuth = false } = {}) {
    const headers = { "Content-Type": "application/json" };

    if (!skipAuth) {
      const token = getToken();
      if (token) headers["Authorization"] = "Bearer " + token;
    }

    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError("Сессия истекла", 401);
    }

    let data = null;
    try { data = await res.json(); } catch (_) { /* пустой ответ */ }

    if (!res.ok) {
      const message = data?.message || `Ошибка запроса (${res.status})`;
      throw new ApiError(message, res.status, data);
    }

    return data;
  }

  return {
    get:    (path, opts)       => request(path, { ...opts, method: "GET" }),
    post:   (path, body, opts) => request(path, { ...opts, method: "POST", body }),
    put:    (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
    patch:  (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
    delete: (path, opts)       => request(path, { ...opts, method: "DELETE" }),
    request
  };
}

/** Расширенный Error с кодом статуса и телом ответа */
export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name   = "ApiError";
    this.status = status;
    this.data   = data;
  }
}
