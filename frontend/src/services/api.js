// src/services/api.js
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://test-d9o3.onrender.com/api';
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds for general requests

console.log('API_BASE_URL:', API_BASE_URL);

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
    const token = localStorage.getItem('token');
    console.log('Retrieved token:', token ? 'Present' : 'Missing');
    return token;
  }

  getHeaders(includeAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (includeAuth) {
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        console.warn('No token available for authenticated request');
      }
    }
    return headers;
  }

  async request(endpoint, options = {}, retries = 3) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: this.getHeaders(options.includeAuth !== false),
      method: options.method || 'GET',
      body: options.body || null,
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      config.signal = controller.signal;
      let timeoutId;

      try {
        console.log(`Attempt ${attempt}/${retries} for ${url}`);
        const timeout = options.timeoutMs || DEFAULT_TIMEOUT_MS;
        timeoutId = setTimeout(() => {
          controller.abort();
        }, timeout);

        const response = await fetch(url, config);
        clearTimeout(timeoutId);

        const text = await response.text();

        if (!response.ok) {
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(`Server returned non-JSON: ${text || 'Empty response'} (Status: ${response.status})`);
          }

          if (response.status === 401 || response.status === 403) {
            console.warn('Authentication error, clearing local storage and redirecting to login');
            localStorage.removeItem('token');
            localStorage.removeItem('userName');
            localStorage.removeItem('userEmail');
            window.location.href = '/login'; // Redirect to login on auth error
          }
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        if (!text) {
          throw new Error('Empty response from server');
        }

        try {
          const parsed = JSON.parse(text);
          console.log(`Response from ${url}:`, parsed);
          return parsed;
        } catch {
          throw new Error('Invalid JSON response from server');
        }
      } catch (error) {
        console.error(`API Error [${endpoint}] (Attempt ${attempt}/${retries}):`, error.message);
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          if (attempt < retries) {
            console.log(`Timeout, retrying ${attempt + 1}/${retries} for ${endpoint}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          } else {
            throw new Error('Yêu cầu quá thời gian, vui lòng thử lại');
          }
        }

        if (attempt < retries) {
          console.log(`Retrying ${attempt + 1}/${retries} for ${endpoint}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        throw error;
      }
    }
  }

  async login({ email, password }) {
    const data = await this.request('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      includeAuth: false,
    });
    console.log('Login response:', data);
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
    console.log('Register response:', data);
    return data;
  }

  async updateProfile({ name, email }) {
    const data = await this.request('/profile', {
      method: 'PUT',
      body: JSON.stringify({ name, email }),
    });
    console.log('Update profile response:', data);
    localStorage.setItem('userName', data.user.name);
    localStorage.setItem('userEmail', data.user.email);
    return data;
  }

  async changePassword({ currentPassword, newPassword }) {
    const data = await this.request('/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    console.log('Change password response:', data);
    return data;
  }

  async deleteAccount() {
    const data = await this.request('/account', { method: 'DELETE' });
    console.log('Delete account response:', data);
    localStorage.clear();
    return data;
  }

  async getChatHistory() {
    const data = await this.request('/chat/history', { method: 'GET' });
    console.log('Chat history response:', data);
    return data;
  }

  async deleteChat(chatId) {
    const data = await this.request(`/chat/${chatId}`, { method: 'DELETE' });
    console.log('Delete chat response:', data);
    return data;
  }

  async deleteMessage(messageId) {
    const data = await this.request(`/message/${messageId}`, { method: 'DELETE' });
    console.log('Delete message response:', data);
    return data;
  }

  async generateImage(options) {
    const data = await this.request('/generate-image', {
      method: 'POST',
      body: JSON.stringify(options),
      timeoutMs: 60000 // 60 seconds for image generation
    });
    console.log('Generate image response:', data);
    return data;
  }
}

const apiService = new ApiService();
export default apiService;
