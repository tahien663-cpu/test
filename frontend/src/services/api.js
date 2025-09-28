// src/services/api.js
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
const DEFAULT_TIMEOUT_MS = 12000;

class ApiService {
  static instance = null;

  constructor() {
    if (!ApiService.instance) {
      this.baseURL = API_BASE_URL;
      ApiService.instance = this;
    }
    return ApiService.instance;
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

      const text = await response.text();

      if (!response.ok) {
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Server returned non-JSON: ${text || 'Empty response'} (Status: ${response.status})`);
        }

        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('token');
          localStorage.removeItem('userName');
          localStorage.removeItem('userEmail');
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (!text) {
        throw new Error('Empty response from server');
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error('Invalid JSON response from server');
      }
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error.message);
      if (error.name === 'AbortError') {
        throw new Error('Yêu cầu quá thời gian, vui lòng thử lại');
      }
      throw error;
    }
  }

  async login({ email, password }) {
    const data = await this.request('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      includeAuth: false,
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('userName', data.user.name);
    localStorage.setItem('userEmail', data.user.email);
    return data;
  }

  async register({ email, password, name }) {
    const data = await this.request('/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
      includeAuth: false,
    });
    return data;
  }

  async updateProfile({ name, email }) {
    const data = await this.request('/profile', {
      method: 'PUT',
      body: JSON.stringify({ name, email }),
    });
    localStorage.setItem('userName', data.user.name);
    localStorage.setItem('userEmail', data.user.email);
    return data;
  }

  async changePassword({ currentPassword, newPassword }) {
    return this.request('/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async deleteAccount() {
    const data = await this.request('/account', { method: 'DELETE' });
    localStorage.clear();
    return data;
  }

  async sendMessage(chatId, message) {
    return this.request(chatId ? `/chat/${chatId}` : '/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  async getChatHistory() {
    return this.request('/chat/history', { method: 'GET' });
  }

  async deleteChat(chatId) {
    return this.request(`/chat/${chatId}`, { method: 'DELETE' });
  }

  async deleteMessage(messageId) {
    return this.request(`/message/${messageId}`, { method: 'DELETE' });
  }

  async generateImage(options) {
    return this.request('/generate-image', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }
}

const apiService = new ApiService();
export default apiService;
