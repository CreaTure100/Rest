import axios from 'axios';

// В dev запросы проксирует Vite, в Docker - nginx. VITE_API_URL нужен, только если API на другом домене.
const API_URL = import.meta.env.VITE_API_URL || '/api';
const LOGIN_PATH = `${import.meta.env.BASE_URL}login`;

// Эти запросы никогда не вызывают обновление токена и перенаправление на вход
const isAuthEndpoint = (url = '') => /\/auth\/(login|register|refresh|logout)$/.test(url);
// Публичным является только ЧТЕНИЕ меню (раньше публичным считался любой url с "/menu", в том числе правки админа)
const isPublicMenuRead = (config) =>
  (config.method || 'get').toLowerCase() === 'get' && /^\/menu(\/\d+)?$/.test(config.url || '');
const isPublicRequest = (config) => isAuthEndpoint(config.url) || isPublicMenuRead(config);

class ApiClient {
  constructor() {
    this.refreshPromise = null;
    this.client = axios.create({ baseURL: API_URL });
    this._setupInterceptors();
  }

  // Токены читаем из localStorage при каждом запросе: так несколько вкладок видят свежие токены друг друга
  get accessToken() {
    return localStorage.getItem('accessToken');
  }

  get refreshTokenValue() {
    return localStorage.getItem('refreshToken');
  }

  _setupInterceptors() {
    this.client.interceptors.request.use((config) => {
      const token = this.accessToken;
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const original = error.config;
        const status = error.response?.status;
        const code = error.response?.data?.code;

        if (!original || isPublicRequest(original)) return Promise.reject(error);

        // Заблокированному пользователю обновлять токен бессмысленно
        if (status === 403 && code === 'USER_BLOCKED') {
          this._handleAuthFailure();
          return Promise.reject(error);
        }
        // 403 = "нет прав", а не "токен истёк": обновление токена только при 401
        if (status !== 401) return Promise.reject(error);
        if (original._retry) {
          this._handleAuthFailure();
          return Promise.reject(error);
        }

        original._retry = true;
        if (await this._refreshOnce()) {
          original.headers.Authorization = `Bearer ${this.accessToken}`;
          return this.client(original);
        }
        this._handleAuthFailure();
        return Promise.reject(error);
      }
    );
  }

  // Параллельные 401 ждут один и тот же запрос на обновление токена
  _refreshOnce() {
    if (!this.refreshPromise) {
      this.refreshPromise = this._refreshAccessToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async _refreshAccessToken() {
    const refreshToken = this.refreshTokenValue;
    if (!refreshToken) return false;
    try {
      const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch (error) {
      console.error('Refresh token error:', error.message);
      return false;
    }
  }

  _handleAuthFailure() {
    this.clearTokens();
    localStorage.removeItem('currentUser');
    if (!window.location.pathname.endsWith('/login')) window.location.href = LOGIN_PATH;
  }

  setTokens(accessToken, refreshToken) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  async _request(method, endpoint, data = null, config = {}) {
    try {
      const requestConfig = { method, url: endpoint, ...config };
      if (data !== null && method !== 'DELETE') requestConfig.data = data;
      const response = await this.client(requestConfig);
      return response.data;
    } catch (error) {
      throw this._formatError(error);
    }
  }

  _formatError(error) {
    if (error.response) {
      return {
        status: error.response.status,
        message: error.response.data?.error || error.response.data?.message || error.response.statusText,
      };
    }
    if (error.request) return { status: 0, message: 'Нет ответа от сервера' };
    return { status: 0, message: error.message };
  }

  // --- авторизация ---
  async login(email, password) {
    const data = await this._request('POST', '/auth/login', { email, password });
    this.setTokens(data.accessToken, data.refreshToken);
    return data.user;
  }

  register(name, email, password) {
    return this._request('POST', '/auth/register', { name, email, password });
  }

  async logout() {
    const refreshToken = this.refreshTokenValue;
    try {
      if (refreshToken) await this._request('POST', '/auth/logout', { refreshToken });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.clearTokens(); // локальный выход выполняется всегда, даже если сервер недоступен
    }
  }

  getMe() {
    return this._request('GET', '/auth/me');
  }

  // --- меню ---
  getMenu() {
    return this._request('GET', '/menu');
  }

  createDish(dishData) {
    return this._request('POST', '/menu', dishData);
  }

  updateDish(dishId, data) {
    return this._request('PUT', `/menu/${dishId}`, data);
  }

  deleteDish(dishId) {
    return this._request('DELETE', `/menu/${dishId}`);
  }

  // --- столики и заказы ---
  getTables(date) {
    return this._request('GET', '/tables', null, date ? { params: { date } } : {});
  }

  bookTable(tableId, timeSlot, date) {
    return this._request('POST', `/tables/${tableId}/book`, { timeSlot, date });
  }

  getOrders() {
    return this._request('GET', '/orders');
  }

  getMyOrders() {
    return this._request('GET', '/orders/my');
  }

  // book: true - бронь и заказ создаются одной транзакцией на сервере
  createOrder(tableId, timeSlot, dishes, clientName) {
    return this._request('POST', '/orders', { tableId, timeSlot, dishes, clientName, book: true });
  }

  serveDish(orderId, dishIndex) {
    return this._request('PUT', `/orders/${orderId}/dish/${dishIndex}/serve`);
  }

  // --- кухня ---
  getKitchenQueue() {
    return this._request('GET', '/kitchen/queue');
  }

  getRecipe(dishId) {
    return this._request('GET', `/kitchen/recipe/${dishId}`);
  }

  startCooking(queueId) {
    return this._request('PUT', `/kitchen/dish/${queueId}/start`);
  }

  completeDish(queueId) {
    return this._request('PUT', `/kitchen/dish/${queueId}/complete`);
  }

  // --- пользователи и статистика ---
  getUsers() {
    return this._request('GET', '/users');
  }

  createEmployee(name, email, password, role) {
    return this._request('POST', '/users/employee', { name, email, password, role });
  }

  updateUser(userId, data) {
    return this._request('PUT', `/users/${userId}`, data);
  }

  blockUser(userId) {
    return this._request('DELETE', `/users/${userId}`);
  }

  getAdminStats() {
    return this._request('GET', '/admin/stats');
  }
}

export default new ApiClient();
