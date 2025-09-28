import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import Navbar from './Navbar';

export default function Home() {
  const navigate = useNavigate();
  const [greeting, setGreeting] = useState({ text: '', icon: null });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isVisible, setIsVisible] = useState(false);
  const [userName, setUserName] = useState(localStorage.getItem('userName') || 'Bạn');
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [accent, setAccent] = useState(() => localStorage.getItem('accent') || 'blue');
  const [particles, setParticles] = useState(() => localStorage.getItem('particles') === 'true');
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('reducedMotion') === 'true');

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 300);

    const updateGreeting = () => {
      const hour = new Date().getHours();
      if (hour < 12) setGreeting({ text: 'Chào Buổi Sáng', icon: Sun, color: 'text-yellow-500' });
      else if (hour < 17) setGreeting({ text: 'Chào Buổi Chiều', icon: Sun, color: 'text-orange-500' });
      else setGreeting({ text: 'Chào Buổi Tối', icon: Moon, color: 'text-blue-400' });
    };

    const updateTime = () => setCurrentTime(new Date());
    updateGreeting();
    updateTime();

    const gInt = setInterval(updateGreeting, 60000);
    const tInt = setInterval(updateTime, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(gInt);
      clearInterval(tInt);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const map = {
      blue: '#2563eb',
      purple: '#7c3aed',
      pink: '#db2777',
      emerald: '#10b981',
      orange: '#f97316',
    };
    localStorage.setItem('accent', accent);
    root.style.setProperty('--accent', map[accent] || '#2563eb');
  }, [accent]);

  useEffect(() => {
    localStorage.setItem('reducedMotion', String(reducedMotion));
    const root = document.documentElement;
    root.style.setProperty('--motion-scale', reducedMotion ? '0' : '1');
  }, [reducedMotion]);

  useEffect(() => {
    localStorage.setItem('particles', String(particles));
  }, [particles]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'accent' && e.newValue) setAccent(e.newValue);
      if (e.key === 'particles') setParticles(e.newValue === 'true');
      if (e.key === 'reducedMotion') setReducedMotion(e.newValue === 'true');
      if (e.key === 'theme' && e.newValue) setTheme(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const quickActions = [
    {
      title: '💬 Chat với AI',
      description: 'Bắt đầu cuộc trò chuyện thông minh',
      onClick: () => navigate('/chat'),
      gradient: 'from-blue-500 to-purple-600',
      icon: '🤖'
    },
    {
      title: '⚙️ Cài Đặt',
      description: 'Tùy chỉnh tài khoản của bạn',
      onClick: () => navigate('/settings'),
      gradient: 'from-purple-500 to-pink-600',
      icon: '🛠️'
    },
    {
      title: '🎨 Giao Diện',
      description: 'Thay đổi theme và màu sắc',
      onClick: () => setTheme(theme === 'light' ? 'dark' : 'light'),
      gradient: 'from-orange-500 to-red-600',
      icon: '🌈'
    }
  ];

  return (
    <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === 'light' ? 'bg-gray-100' : 'bg-gray-900'}`}>
      {/* Background Image for Light Theme */}
      {theme === 'light' && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('/back2.png')",
          }}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
        </div>
      )}

      {/* Dark Theme Background */}
      {theme === 'dark' && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('/back1.png')",
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        </div>
      )}

      {/* Optional Particles Layer */}
      {particles && !reducedMotion && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {[...Array(16)].map((_, i) => (
            <div
              key={i}
              className={`absolute rounded-full ${theme === 'light' ? '' : 'animate-pulse'}`}
              style={{
                width: `${6 + (i % 4) * 2}px`,
                height: `${6 + (i % 4) * 2}px`,
                left: `${(i * 61) % 100}%`,
                top: `${(i * 37) % 100}%`,
                background: 'var(--accent, #2563eb)',
                opacity: theme === 'light' ? 0.15 : 0.25,
                filter: 'blur(1px)'
              }}
            />
          ))}
        </div>
      )}

      {/* Navbar */}
      <Navbar isChatPage={false} theme={theme} setTheme={setTheme} />

      {/* Greeting */}
      <div
        className={`relative z-10 max-w-4xl mx-auto text-center mt-16 sm:mt-20 flex-1 flex items-center justify-center transition-all duration-1000 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
        }`}
      >
        <div className={`backdrop-blur-2xl shadow-2xl rounded-3xl p-6 sm:p-8 w-full ${theme === 'light' ? 'bg-white/80' : 'bg-white/[0.08]'}`}>
          <h1 className={`text-5xl sm:text-6xl font-bold mb-4 ${theme === 'light' ? 'text-gray-800' : 'bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent'}`}>
            <div className="flex items-center justify-center gap-3">
              {greeting.icon && (
                <greeting.icon 
                  className={`w-12 h-12 sm:w-16 sm:h-16 ${greeting.color} drop-shadow-lg animate-pulse`} 
                />
              )}
              <span>{greeting.text}, {userName}!</span>
            </div>
          </h1>
          <p className={`text-lg ${theme === 'light' ? 'text-gray-600' : 'text-white/80'}`}>
            {currentTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="relative z-10 max-w-4xl mx-auto mt-8 mb-8 px-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickActions.map((action, index) => (
            <button
              key={index}
              onClick={action.onClick}
              className={`relative group p-4 rounded-xl ${theme === 'light' ? 'bg-white shadow-md' : 'bg-white/[0.05] hover:bg-white/[0.1]'} transition-all duration-300 hover:scale-105 hover:shadow-lg ${theme === 'light' ? 'hover:shadow-gray-300/50' : 'hover:shadow-purple-500/20'}`}
            >
              <div className={`absolute -inset-1 bg-gradient-to-r ${action.gradient} rounded-xl blur opacity-0 group-hover:opacity-30 transition-all duration-300`} />
              <div className="relative flex items-center space-x-3">
                <span className={`text-2xl transform group-hover:scale-110 transition-transform duration-300 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}>{action.icon}</span>
                <div className="text-left">
                  <h3 className={`font-semibold text-lg ${theme === 'light' ? 'text-gray-800' : 'text-white'}`}>{action.title}</h3>
                  <p className={`text-sm ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>{action.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Change Log Modal */}
      {showChangeLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 transition-opacity duration-300">
          <div className={`backdrop-blur-2xl rounded-3xl p-6 sm:p-8 max-w-md w-full transform transition-all duration-300 scale-95 animate-[modalIn_0.3s_ease-out_forwards] ${theme === 'light' ? 'bg-white' : 'bg-white/[0.08]'}`}>
            <h2 className={`text-2xl font-bold mb-4 ${theme === 'light' ? 'text-gray-800' : 'text-white'}`}>🚀 Change Log</h2>
            <ul className={`text-white/80 list-disc list-inside space-y-2 text-sm sm:text-base ${theme === 'light' ? 'text-gray-700' : 'text-white/80'}`}>
              <li>25/09/2025 - v2.1:
                <ul className="list-circle ml-6 space-y-1">
                  <li>Thêm API verify token và get profile</li>
                  <li>Thêm chat history endpoint (mock)</li>
                  <li>Cải thiện ApiService với singleton class</li>
                  <li>Cập nhật error handling và base URL</li>
                </ul>
              </li>
              <li>23/09/2025 - v2.0:
                <ul className="list-circle ml-6 space-y-1">
                  <li>Thêm hiệu ứng particles động</li>
                  <li>Cải thiện responsive design</li>
                  <li>Thêm animation chuyển trang mượt mà</li>
                  <li>Tối ưu hiệu ứng hover và focus</li>
                  <li>Thêm chức năng Cài Đặt và Giao Diện</li>
                  <li>Thêm modal Change Log và gradient tùy chỉnh</li>
                </ul>
              </li>
              <li>23/09/2025 - v1.5:
                <ul className="list-circle ml-6 space-y-1">
                  <li>Cập nhật UI với gradient và blur effects</li>
                  <li>Tích hợp AI chat API backend</li>
                  <li>Thêm hiển thị thời gian thực</li>
                  <li>Cải thiện trải nghiệm người dùng</li>
                </ul>
              </li>
              <li>23/09/2025 - v1.0:
                <ul className="list-circle ml-6 space-y-1">
                  <li>Phiên bản đầu tiên</li>
                  <li>Chức năng đăng nhập/đăng ký cơ bản</li>
                  <li>Chat với AI</li>
                  <li>Giao diện responsive</li>
                </ul>
              </li>
            </ul>
            <button
              onClick={() => setShowChangeLog(false)}
              className={`mt-6 px-4 py-2 rounded-xl transition-all duration-200 hover:scale-105 ${theme === 'light' ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-purple-500/20'}`}
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Change Log Button */}
      <button
        onClick={() => setShowChangeLog(true)}
        className={`fixed bottom-4 right-4 px-4 py-2 rounded-xl font-semibold transition-all duration-200 hover:scale-105 shadow-lg ${theme === 'light' ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-300/30' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-purple-500/30'}`}
      >
        Change Log
      </button>
    </div>
  );
}