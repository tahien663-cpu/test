import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [focusedField, setFocusedField] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  // API service functions
  const apiService = {
    login: async (credentials) => {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (parseError) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      return await response.json();
    },

    register: async (userData) => {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (parseError) {
          if (response.status === 404) {
            throw new Error('Register functionality is not available yet. Please contact administrator.');
          }
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      return await response.json();
    },

    verifyToken: async () => {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');

      const response = await fetch('/api/chat/history', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        throw new Error('Token verification failed');
      }
      
      return { valid: true };
    }
  };

  const handleSubmit = useCallback(async () => {
    const email = (formData.email || '').trim().toLowerCase();
    const password = (formData.password || '').trim();
    const name = (formData.name || '').trim();

    if (!email || !password || (isRegister && !name)) {
      setMessage({ text: 'Vui lòng điền đầy đủ thông tin', type: 'error' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setMessage({ text: 'Email không hợp lệ', type: 'error' });
      return;
    }
    
    if (password.length < 6) {
      setMessage({ text: 'Mật khẩu phải có ít nhất 6 ký tự', type: 'error' });
      return;
    }

    setIsLoading(true);
    setMessage({ text: '', type: '' });

    try {
      let data;
      
      if (isRegister) {
        data = await apiService.register({ name, email, password });
        setMessage({ text: 'Đăng ký thành công!', type: 'success' });
        setFormData({ name: '', email: '', password: '' });
        
        setTimeout(() => {
          setIsRegister(false);
          setMessage({ text: 'Vui lòng đăng nhập với tài khoản mới.', type: 'success' });
        }, 1500);
      } else {
        data = await apiService.login({ email, password });
        
        if (data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('userName', data.user?.name || 'User');
          localStorage.setItem('userEmail', data.user?.email || '');

          setMessage({ text: 'Đăng nhập thành công!', type: 'success' });

          try {
            await apiService.verifyToken();
            setTimeout(() => {
              navigate('/home');
            }, 1500);
          } catch (verifyError) {
            console.error('Token verification failed:', verifyError);
            localStorage.removeItem('token');
            localStorage.removeItem('userName');
            localStorage.removeItem('userEmail');
            setMessage({ text: 'Phiên đăng nhập không hợp lệ, vui lòng thử lại', type: 'error' });
          }
        } else {
          throw new Error('Không nhận được token từ server');
        }
      }
    } catch (error) {
      console.error('Authentication error:', error);
      setMessage({ 
        text: error.message || 'Không thể kết nối tới server', 
        type: 'error' 
      });
    }

    setIsLoading(false);
  }, [formData, isRegister, navigate]);

  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (message.text) {
      setMessage({ text: '', type: '' });
    }
  }, [message.text]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !isLoading) {
      handleSubmit();
    }
  }, [handleSubmit, isLoading]);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword(prev => !prev);
  }, []);

  const switchMode = useCallback(() => {
    setIsRegister(prev => !prev);
    setFormData({ name: '', email: '', password: '' });
    setMessage({ text: '', type: '' });
  }, []);

  const clearMessageOnFocus = useCallback(() => {
    if (message.text) {
      setMessage({ text: '', type: '' });
    }
  }, [message.text]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-white">
      {/* Background Image with Blur */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/back1.png')",
          filter: 'blur(8px)',
          WebkitFilter: 'blur(8px)',
          transform: 'scale(1.1)',
        }}
      />
      {/* Overlay to enhance contrast */}
      <div className="absolute inset-0 bg-black/10" />

      {/* Main Form Container */}
      <div className={`relative z-10 w-full max-w-md mx-4 transition-all duration-1000 ease-out transform ${isRegister ? 'scale-105' : 'scale-100'}`}>
        <div className="absolute -inset-6 bg-white/20 rounded-3xl blur-3xl opacity-50" />
        
        <div className="relative backdrop-blur-md bg-white/90 border border-gray-200 shadow-xl rounded-3xl p-8 group hover:bg-white/95 transition-all duration-700 hover:shadow-2xl hover:scale-[1.02]">
          
          {/* Header */}
          <div className="text-center mb-8">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-24 h-24 rounded-full mb-6 shadow-2xl transition-all duration-1000 group-hover:shadow-purple-500/50 mx-auto"
            />

            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-gray-800 via-blue-600 to-purple-600 bg-clip-text text-transparent">
              Hein AI
            </h1>
            <p className="text-gray-600 text-sm">Nền tảng AI thông minh & gọn nhẹ và đặc biệt là unlimited</p>
          </div>

          {/* Message Display */}
          {message.text && (
            <div className={`mb-6 p-4 rounded-lg text-center font-medium transition-all duration-300 ${
              message.type === 'success' 
                ? 'bg-green-100 text-green-700 border border-green-200' 
                : 'bg-red-100 text-red-700 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Name Field (only for register) */}
            {isRegister && (
              <div className="relative group">
                <div className={`absolute -inset-2 bg-gradient-to-r from-blue-200 to-cyan-200 rounded-xl blur-lg opacity-0 group-hover:opacity-30 transition-all duration-500 ${
                  focusedField === 'name' ? 'opacity-50 blur-md scale-105' : ''
                }`} />
                <div className="relative flex items-center">
                  <div className="absolute left-4 text-gray-500 transition-colors duration-300 group-focus-within:text-blue-500">
                    <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Họ và tên đầy đủ"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    onFocus={() => {
                      setFocusedField('name');
                      clearMessageOnFocus();
                    }}
                    onBlur={() => setFocusedField('')}
                    onKeyPress={handleKeyPress}
                    className="relative w-full pl-12 pr-4 py-4 bg-white/80 border border-gray-300 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-blue-300 transition-all duration-500 focus:scale-105 focus:shadow-lg"
                    autoComplete="name"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            {/* Email Field */}
            <div className="relative group">
              <div className={`absolute -inset-2 bg-gradient-to-r from-blue-200 to-cyan-200 rounded-xl blur-lg opacity-0 group-hover:opacity-30 transition-all duration-500 ${
                focusedField === 'email' ? 'opacity-50 blur-md scale-105' : ''
              }`} />
              <div className="relative flex items-center">
                <div className="absolute left-4 text-gray-500 transition-colors duration-300 group-focus-within:text-blue-500">
                  <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
                  </svg>
                </div>
                <input
                  type="email"
                  placeholder="Email của bạn"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  onFocus={() => {
                    setFocusedField('email');
                    clearMessageOnFocus();
                  }}
                  onBlur={() => setFocusedField('')}
                  onKeyPress={handleKeyPress}
                  className="relative w-full pl-12 pr-4 py-4 bg-white/80 border border-gray-300 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-blue-300 transition-all duration-500 focus:scale-105 focus:shadow-lg"
                  autoComplete="email"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="relative group">
              <div className={`absolute -inset-2 bg-gradient-to-r from-blue-200 to-cyan-200 rounded-xl blur-lg opacity-0 group-hover:opacity-30 transition-all duration-500 ${
                focusedField === 'password' ? 'opacity-50 blur-md scale-105' : ''
              }`} />
              <div className="relative flex items-center">
                <div className="absolute left-4 text-gray-500 transition-colors duration-300 group-focus-within:text-blue-500">
                  <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path fillRule="evenodd" d="M8 0a4 4 0 0 1 4 4v2.05a2.5 2.5 0 0 1 2 2.45v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4m0 1a3 3 0 0 0-3 3v2h6V4a3 3 0 0 0-3-3"/>
                  </svg>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mật khẩu bảo mật"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  onFocus={() => {
                    setFocusedField('password');
                    clearMessageOnFocus();
                  }}
                  onBlur={() => setFocusedField('')}
                  onKeyPress={handleKeyPress}
                  className="relative w-full pl-12 pr-12 py-4 bg-white/80 border border-gray-300 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-blue-300 transition-all duration-500 focus:scale-105 focus:shadow-lg"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  minLength={6}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={togglePasswordVisibility}
                  className="absolute right-4 text-gray-500 hover:text-gray-700 transition-colors duration-300 disabled:cursor-not-allowed"
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/>
                      <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/>
                      <path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/>
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/>
                      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button 
            onClick={handleSubmit}
            disabled={isLoading}
            className="relative w-full group disabled:cursor-not-allowed mt-6"
          >
            <div className="absolute -inset-2 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 rounded-xl blur-lg opacity-70 group-hover:opacity-90 group-active:opacity-80 transition-all duration-500" />
            <div className={`relative px-8 py-5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl font-bold text-white shadow-xl transform transition-all duration-300 flex items-center justify-center text-lg ${
              isLoading ? 'scale-95 opacity-80' : 'group-hover:scale-105 group-active:scale-95 group-hover:shadow-lg'
            }`}>
              {isLoading ? (
                <>
                  <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin mr-3" />
                  Đang xử lý...
                </>
              ) : (
                <>
                  <svg className="w-6 h-6 mr-3" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path fillRule="evenodd" d="M6 3.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 0-1 0v2A1.5 1.5 0 0 0 6.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-8A1.5 1.5 0 0 0 5 3.5v2a.5.5 0 0 0 1 0z"/>
                    <path fillRule="evenodd" d="M11.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H1.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708z"/>
                  </svg>
                  {isRegister ? "Tạo Tài Khoản" : "Đăng Nhập"}
                  <svg className="w-6 h-6 ml-3 group-hover:translate-x-2 transition-transform duration-300" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
                  </svg>
                </>
              )}
            </div>
          </button>

          {/* Toggle Login/Register */}
          <div className="text-center mt-8">
            <p className="text-gray-600 mb-4 text-lg">
              {isRegister ? "Đã có tài khoản rồi?" : "Chưa có tài khoản?"}
            </p>
            <button 
              onClick={switchMode}
              disabled={isLoading}
              className="relative text-blue-500 hover:text-blue-600 font-bold text-xl hover:underline transition-all duration-500 transform hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded-lg px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="relative z-10">
                {isRegister ? (
                  <>
                    <svg className="w-6 h-6 inline-block mr-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/>
                    </svg>
                    Đăng nhập ngay
                  </>
                ) : (
                  <>
                    <svg className="w-6 h-6 inline-block mr-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/>
                    </svg>
                    Đăng ký miễn phí
                  </>
                )}
              </span>
              <div className="absolute inset-0 bg-blue-200/20 rounded-lg blur opacity-0 hover:opacity-100 transition-opacity duration-500" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}