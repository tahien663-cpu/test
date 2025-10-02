import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, MessageCircle, Settings, Palette, Info, X } from 'lucide-react';
import Navbar from './Navbar';

export default function Home() {
  const navigate = useNavigate();
  const [greeting, setGreeting] = useState({ text: '', icon: null });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isVisible, setIsVisible] = useState(false);
  const [userName, setUserName] = useState('Bạn');
  const [showAbout, setShowAbout] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [accent, setAccent] = useState('blue');
  const [particles, setParticles] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

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
    root.style.setProperty('--accent', map[accent] || '#2563eb');
  }, [accent]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--motion-scale', reducedMotion ? '0' : '1');
  }, [reducedMotion]);

  const quickActions = [
    {
      title: 'Chat với AI',
      description: 'Bắt đầu cuộc trò chuyện thông minh',
      onClick: () => navigate('/chat'),
      gradient: 'from-blue-500 to-purple-600',
      icon: MessageCircle
    },
    {
      title: 'Cài Đặt',
      description: 'Tùy chỉnh tài khoản của bạn',
      onClick: () => navigate('/settings'),
      gradient: 'from-purple-500 to-pink-600',
      icon: Settings
    },
    {
      title: 'Giao Diện',
      description: 'Thay đổi theme và màu sắc',
      onClick: () => setTheme(theme === 'light' ? 'dark' : 'light'),
      gradient: 'from-orange-500 to-red-600',
      icon: Palette
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

      {/* Main Content Container */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12">
        {/* Greeting Section */}
        <div
          className={`w-full max-w-4xl text-center mb-8 sm:mb-12 transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
        >
          <div className={`backdrop-blur-2xl shadow-2xl rounded-2xl sm:rounded-3xl p-6 sm:p-8 ${theme === 'light' ? 'bg-white/80' : 'bg-white/[0.08]'}`}>
            <h1 className={`text-3xl sm:text-5xl lg:text-6xl font-bold mb-3 sm:mb-4 ${theme === 'light' ? 'text-gray-800' : 'bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent'}`}>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
                {greeting.icon && (
                  <greeting.icon 
                    className={`w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 ${greeting.color} drop-shadow-lg animate-pulse`} 
                  />
                )}
                <span className="break-words">{greeting.text}, {userName}!</span>
              </div>
            </h1>
            <p className={`text-base sm:text-lg ${theme === 'light' ? 'text-gray-600' : 'text-white/80'}`}>
              {currentTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="w-full max-w-4xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {quickActions.map((action, index) => (
              <button
                key={index}
                onClick={action.onClick}
                className={`relative group p-4 sm:p-5 rounded-xl ${theme === 'light' ? 'bg-white shadow-md' : 'bg-white/[0.05] hover:bg-white/[0.1]'} transition-all duration-300 hover:scale-105 hover:shadow-lg ${theme === 'light' ? 'hover:shadow-gray-300/50' : 'hover:shadow-purple-500/20'}`}
              >
                <div className={`absolute -inset-1 bg-gradient-to-r ${action.gradient} rounded-xl blur opacity-0 group-hover:opacity-30 transition-all duration-300`} />
                <div className="relative flex items-center space-x-3 sm:space-x-4">
                  <action.icon 
                    className={`w-8 h-8 sm:w-10 sm:h-10 transform group-hover:scale-110 transition-transform duration-300 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`}
                  />
                  <div className="text-left flex-1">
                    <h3 className={`font-semibold text-base sm:text-lg ${theme === 'light' ? 'text-gray-800' : 'text-white'}`}>
                      {action.title}
                    </h3>
                    <p className={`text-xs sm:text-sm mt-0.5 ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>
                      {action.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* About Modal */}
      {showAbout && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 transition-opacity duration-300"
          onClick={() => setShowAbout(false)}
        >
          <div 
            className={`backdrop-blur-2xl rounded-2xl sm:rounded-3xl p-6 sm:p-8 max-w-md w-full transform transition-all duration-300 ${theme === 'light' ? 'bg-white' : 'bg-white/[0.08]'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-xl sm:text-2xl font-bold flex items-center gap-2 ${theme === 'light' ? 'text-gray-800' : 'text-white'}`}>
                <Info className="w-6 h-6" />
                About
              </h2>
              <button
                onClick={() => setShowAbout(false)}
                className={`p-1 rounded-lg transition-colors ${theme === 'light' ? 'hover:bg-gray-200' : 'hover:bg-white/10'}`}
              >
                <X className={`w-5 h-5 ${theme === 'light' ? 'text-gray-600' : 'text-white/80'}`} />
              </button>
            </div>
            <div className={`space-y-3 text-sm sm:text-base ${theme === 'light' ? 'text-gray-700' : 'text-white/80'}`}>
              <p><strong>Hein AI</strong> là một ứng dụng chat AI hiện đại, được phát triển để mang lại trải nghiệm trò chuyện tự nhiên và thông minh.</p>
              <p className="flex items-start gap-2">
                <span>✨</span>
                <span>Các tính năng chính:</span>
              </p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li>Trò chuyện với AI thời gian thực</li>
                <li>Giao diện hiện đại, hỗ trợ Light/Dark Mode</li>
                <li>Tùy chỉnh hiệu ứng và giao diện</li>
                <li>Tích hợp API backend để mở rộng chức năng</li>
              </ul>
              <p>📅 Phiên bản hiện tại: <strong>v2.1</strong></p>
              <p>👨‍💻 Nhà phát triển: <strong>Hien2309</strong></p>
            </div>
            <button
              onClick={() => setShowAbout(false)}
              className={`mt-6 w-full sm:w-auto px-6 py-2.5 rounded-xl transition-all duration-200 hover:scale-105 font-medium ${theme === 'light' ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-purple-500/20'}`}
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* About Button */}
      <button
        onClick={() => setShowAbout(true)}
        className={`fixed bottom-4 right-4 p-3 sm:px-4 sm:py-2.5 rounded-xl font-semibold transition-all duration-200 hover:scale-105 shadow-lg flex items-center gap-2 ${theme === 'light' ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-300/30' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-purple-500/30'}`}
      >
        <Info className="w-5 h-5" />
        <span className="hidden sm:inline">About</span>
      </button>
    </div>
  );
}
