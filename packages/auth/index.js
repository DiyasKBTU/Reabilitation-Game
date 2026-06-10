/**
 * packages/auth — JWT helpers для RehabGame
 *
 * Заменяет shared/auth.js.
 * ES-модуль. Хранит токен в localStorage. Без зависимостей.
 *
 * Использование (vanilla JS или внутри Zustand store):
 *   import { AuthStore } from '../../packages/auth/index.js';
 *
 *   AuthStore.login({ token, role, username, userId });
 *   AuthStore.isLoggedIn()  → boolean
 *   AuthStore.role()        → "doctor" | "patient" | "admin"
 *   AuthStore.token()       → string | null
 *   AuthStore.logout()
 */

const KEYS = {
  token:    "rehab_token",
  role:     "rehab_role",
  username: "rehab_username",
  userId:   "rehab_userId"
};

export const AuthStore = {
  /** Сохраняет данные после успешного логина */
  login({ token, role, username, userId }) {
    localStorage.setItem(KEYS.token,    token);
    localStorage.setItem(KEYS.role,     role);
    localStorage.setItem(KEYS.username, username || "");
    localStorage.setItem(KEYS.userId,   userId   || "");
  },

  /** Очищает всё и возвращает на /login (только в браузере) */
  logout(redirectTo = "/login") {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    if (typeof window !== "undefined") window.location.href = redirectTo;
  },

  // ─── Геттеры ──────────────────────────────────────────────────────────────

  token()    { return localStorage.getItem(KEYS.token);    },
  role()     { return localStorage.getItem(KEYS.role)     || "patient"; },
  username() { return localStorage.getItem(KEYS.username) || ""; },
  userId()   { return localStorage.getItem(KEYS.userId)   || ""; },

  isLoggedIn() {
    return !!localStorage.getItem(KEYS.token);
  },

  /**
   * Проверяет авторизацию. Если не авторизован — редиректит.
   * Возвращает false если нет токена (для ранних выходов).
   */
  requireAuth(loginPath = "/login") {
    if (!this.isLoggedIn()) {
      if (typeof window !== "undefined") window.location.href = loginPath;
      return false;
    }
    return true;
  },

  /**
   * Проверяет авторизацию + роль.
   * @param {string[]} roles  - список разрешённых ролей
   * @param {string}   fallback - куда редиректить если роль не совпала
   */
  requireRole(roles, fallback = "/game-select") {
    if (!this.requireAuth()) return false;
    if (!roles.includes(this.role())) {
      if (typeof window !== "undefined") window.location.href = fallback;
      return false;
    }
    return true;
  }
};
