// src/services/api.js - Singleton API Service (Enhanced)
const API_BASE_URL = 'http://localhost:3001/api';  // TODO: move to env for prod
const DEFAULT_TIMEOUT_MS = 12000;

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  getToken() {
    return localStorage.getItem('token');
  }

  getHeaders(includeAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (includeAuth) {
      const token = this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: this.getHeaders(options.includeAuth !== false),
      ...options,
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
      const response = await fetch(url, { ...config, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // auto sign-out on 401/403
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('token');
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return response.json();
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error.message);
      if (error.name === 'AbortError') {
        throw new Error('Yêu cầu quá thời gian, vui lòng thử lại');
      }
      throw error;
    }
  }

  // Auth
  async register(userData) {
    return this.request('/register', { method: 'POST', body: JSON.stringify(userData), includeAuth: false });
  }

  async login(credentials) {
    return this.request('/login', { method: 'POST', body: JSON.stringify(credentials), includeAuth: false });
  }

  async verifyToken() {
    return this.request('/verify', { method: 'GET', includeAuth: true });
  }

  // User
  async getUserProfile() {
    return this.request('/user/profile', { method: 'GET' });
  }

  async updateProfile(profileData) {
    return this.request('/update-profile', { method: 'PUT', body: JSON.stringify(profileData) });
  }

  async changePassword(passwordData) {
    return this.request('/user/change-password', { method: 'PUT', body: JSON.stringify(passwordData) });
  }

  async deleteAccount() {
    return this.request('/user/account', { method: 'DELETE' });
  }

  // Chat
  async sendMessage(message) {
    return this.request('/chat', { method: 'POST', body: JSON.stringify({ message }) });
  }

  async getChatHistory() {
    return this.request('/chat/history', { method: 'GET' });
  }
}

const apiService = new ApiService();
export default apiService;