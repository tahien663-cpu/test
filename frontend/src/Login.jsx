// src/components/Login.jsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import apiService from '../services/api';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [focusedField, setFocusedField] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

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
            await apiService.getChatHistory();
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

  const switchMode = useCallback(() => {
    setIsRegister(!isRegister);
    setFormData({ name: '', email: '', password: '' });
    setMessage({ text: '', type: '' });
  }, [isRegister]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, isLoading]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      apiService.getChatHistory().then(() => navigate('/home')).catch(() => {});
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-white">
      <div className="absolute inset-0 bg-black/10" />
      <div className="relative z-10 max-w-md w-full p-8 bg-white/80 rounded-3xl shadow-2xl">
        <img 
          src="/logo.png" 
          alt="Hein AI" 
          className="w-24 h-24 rounded-full mb-6 shadow-2xl transition-all duration-1000 group-hover:shadow-purple-500/50 mx-auto" 
        />
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">
          {isRegister ? "Tạo Tài Khoản" : "Đăng Nhập"}
        </h1>
        <p className="text-gray-600 mb-4 text-lg text-center">
          Nền tảng AI thông minh & gọn nhẹ và đặc biệt là unlimited
        </p>

        {message.text && (
          <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
            {message.type === 'success' ? '✅' : '❌'} {message.text}
          </div>
        )}

        <div className="space-y-6">
          {isRegister && (
            <div className={`relative flex items-center transition-all duration-300 ${focusedField === 'name' ? 'scale-105 shadow-lg' : ''}`}>
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/>
              </svg>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                onKeyDown={handleKeyPress}
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField('')}
                placeholder="Họ và tên"
                className="w-full pl-12 pr-4 py-4 bg-white/80 border border-gray-300 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-blue-300 transition-all duration-500"
                disabled={isLoading}
              />
            </div>
          )}

          <div className={`relative flex items-center transition-all duration-300 ${focusedField === 'email' ? 'scale-105 shadow-lg' : ''}`}>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
            </svg>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              onKeyDown={handleKeyPress}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField('')}
              placeholder="Email"
              className="w-full pl-12 pr-4 py-4 bg-white/80 border border-gray-300 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-blue-300 transition-all duration-500"
              disabled={isLoading}
              autoComplete="username"
            />
          </div>

          <div className={`relative flex items-center transition-all duration-300 ${focusedField === 'password' ? 'scale-105 shadow-lg' : ''}`}>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M3.5 11.5a3.5 3.5 0 1 1 3.163-5H14L15.5 8 14 9.5l-1-1-1 1-1-1-1 1-1-1-1 1H6.663a3.5 3.5 0 0 1-3.163 2M2.5 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/>
            </svg>
            <input
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              onKeyDown={handleKeyPress}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField('')}
              placeholder="Mật khẩu bảo mật"
              className="w-full pl-12 pr-12 py-4 bg-white/80 border border-gray-300 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-blue-300 transition-all duration-500"
              disabled={isLoading}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors duration-300 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              {showPassword ? (
                <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/>
                  <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/>
                </svg>
              ) : (
                <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/>
                  <path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/>
                </svg>
              )}
            </button>
          </div>
        </div>

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
                  <path fillRule="evenodd" d="M11.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H1.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"/>
                </svg>
                {isRegister ? "Tạo Tài Khoản" : "Đăng Nhập"}
                <svg className="w-6 h-6 ml-3 group-hover:translate-x-2 transition-transform duration-300" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
                </svg>
              </>
            )}
          </div>
        </button>

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
  );
}
