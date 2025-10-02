import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, MessageCircle, Settings, Palette, Sparkles, Layout, Zap, Calendar, User } from 'lucide-react';
import Navbar from './Navbar';

export default function Home() {
  const navigate = useNavigate();
  const [greeting, setGreeting] = useState({ text: '', icon: null });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isVisible, setIsVisible] = useState(false);
  const [userName, setUserName] = useState(localStorage.getItem('userName') || 'User');
  const [showAbout, setShowAbout] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [accent, setAccent] = useState(() => localStorage.getItem('accent') || 'blue');
  const [particles, setParticles] = useState(() => localStorage.getItem('particles') === 'true');
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('reducedMotion') === 'true');

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 300);

    const updateGreeting = () => {
      const hour = new Date().getHours();
      if (hour < 12) setGreeting({ text: `Chào Buổi Sáng, ${userName}`, icon: Sun, color: 'text-yellow-500' });
      else if (hour < 17) setGreeting({ text: `Chào Buổi Chiều, ${userName}`, icon: Sun, color: 'text-orange-500' });
      else setGreeting({ text: `Chào Buổi Tối, ${userName}`, icon: Moon, color: 'text-blue-400' });
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
  }, [userName]);

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
      if (e.key === 'userName' && e.newValue) setUserName(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

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
              <span>{greeting.text}!</span>
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
                <action.icon className={`w-6 h-6 transform group-hover:scale-110 transition-transform duration-300 ${theme === 'light' ? 'text-gray-700' : 'text-white'}`} />
                <div className="text-left">
                  <h3 className={`font-semibold text-lg ${theme === 'light' ? 'text-gray-800' : 'text-white'}`}>{action.title}</h3>
                  <p className={`text-sm ${theme === 'light' ? 'text-gray-500' : 'text-white/60'}`}>{action.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* About Modal */}
      {showAbout && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 transition-opacity duration-300 px-4">
          <div className={`backdrop-blur-2xl rounded-3xl p-6 sm:p-8 max-w-lg w-full transform transition-all duration-300 scale-95 animate-[modalIn_0.3s_ease-out_forwards] ${theme === 'light' ? 'bg-white' : 'bg-white/[0.08]'}`}>
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className={`w-7 h-7 ${theme === 'light' ? 'text-blue-600' : 'text-blue-400'}`} />
              <h2 className={`text-2xl font-bold ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>About Hein AI</h2>
            </div>
            
            <div className={`space-y-4 ${theme === 'light' ? 'text-gray-800' : 'text-white/90'}`}>
              <p>
                <strong className={theme === 'light' ? 'text-gray-900' : 'text-white'}>Hein AI</strong> là một ứng dụng chat AI hiện đại, được phát triển để mang lại trải nghiệm trò chuyện tự nhiên và thông minh.
              </p>
              
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className={`w-5 h-5 ${theme === 'light' ? 'text-blue-600' : 'text-blue-400'}`} />
                  <p className={`font-semibold ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>Các tính năng chính:</p>
                </div>
                <ul className="list-disc list-inside ml-7 space-y-1">
                  <li>Trò chuyện với AI thời gian thực</li>
                  <li>Giao diện hiện đại, hỗ trợ Light/Dark Mode</li>
                  <li>Tùy chỉnh hiệu ứng và giao diện</li>
                  <li>Tích hợp API backend để mở rộng chức năng</li>
                </ul>
              </div>
              
              <div className="flex items-center gap-2 pt-2">
                <Calendar className={`w-5 h-5 ${theme === 'light' ? 'text-blue-600' : 'text-blue-400'}`} />
                <p>Phiên bản hiện tại: <strong className={theme === 'light' ? 'text-gray-900' : 'text-white'}>v2.1</strong></p>
              </div>
              
              <div className="flex items-center gap-2">
                <User className={`w-5 h-5 ${theme === 'light' ? 'text-blue-600' : 'text-blue-400'}`} />
                <p>Nhà phát triển: <strong className={theme === 'light' ? 'text-gray-900' : 'text-white'}>Hien2309</strong></p>
              </div>
            </div>
            
            <button
              onClick={() => setShowAbout(false)}
              className={`mt-6 w-full px-4 py-2 rounded-xl transition-all duration-200 hover:scale-105 font-semibold ${theme === 'light' ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-purple-500/20'}`}
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* About Button */}
      <button
        onClick={() => setShowAbout(true)}
        className={`fixed bottom-4 right-4 px-4 py-2 rounded-xl font-semibold transition-all duration-200 hover:scale-105 shadow-lg ${theme === 'light' ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-300/30' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-purple-500/30'}`}
      >
        About
      </button>
    </div>
  );
}
