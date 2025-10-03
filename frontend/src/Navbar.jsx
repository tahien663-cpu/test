import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { Sun, Moon, Menu, X, User, LogOut, Home, MessageSquare, Settings } from 'lucide-react'; 
import { motion, AnimatePresence } from 'framer-motion';

const CUSTOM_LOGO_PATH = '/logo.png'; 

export default function Navbar({ isChatPage, theme: controlledTheme, setTheme: setControlledTheme }) {

  const navigate = useNavigate(); 
  
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [uncontrolledTheme, setUncontrolledTheme] = useState('light');
  const [userName, setUserName] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem('userName') || '';
    setUserName(name);
    if (controlledTheme == null) {
      const savedTheme = localStorage.getItem('theme') || 'dark';
      setUncontrolledTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }

    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [controlledTheme]);

  const initials = userName
    ? userName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  const currentTheme = controlledTheme ?? uncontrolledTheme;

  const toggleTheme = () => {
    const next = currentTheme === 'light' ? 'dark' : 'light';
    if (setControlledTheme) {
      setControlledTheme(next);
      localStorage.setItem('theme', next);
    } else {
      setUncontrolledTheme(next);
      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
    }
  };

  const handleLogout = () => {
    setShowConfirm(true);
    setDropdownOpen(false);
    setMenuOpen(false);
  };

  const confirmLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    setShowConfirm(false);
    navigate('/');
  };

  const cancelLogout = () => setShowConfirm(false);

  const toChat = () => navigate('/chat');
  const toHome = () => navigate('/home');

  const renderLogoContent = () => {
    if (imageError) {
      return <span className="text-white font-extrabold text-2xl">H</span>;
    }
    
    return (
      <img
        src={CUSTOM_LOGO_PATH}
        alt="Logo Hein AI"
        className="w-10 h-10 object-contain"
        onError={() => setImageError(true)}
      />
    );
  };

  const renderChatHomeIcon = () => {
    if (isChatPage) {
        return <Home className="inline-block w-4 h-4" />;
    }
    return <MessageSquare className="inline-block w-4 h-4" />;
  };

  return (
    <>
      <motion.nav 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        style={{ left: '50%', transform: 'translateX(-50%)' }}
        className={`fixed top-4 w-[calc(100%-2rem)] max-w-5xl transition-all duration-300 z-50 ${
          scrolled 
            ? 'bg-white/95 dark:bg-gray-900/95 shadow-2xl' 
            : 'bg-gradient-to-r from-sky-500/70 to-indigo-600/70 shadow-xl'
        } backdrop-blur-xl border border-white/20 rounded-2xl px-6 py-3`}
      >
        <div className="flex items-center justify-between gap-4">
          {/* Logo Section */}
          <div className="flex items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/')}
              className="flex items-center gap-3 focus:outline-none group"
            >
              <div className="relative">
                <motion.div 
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                    scrolled 
                      ? 'bg-gradient-to-br from-sky-500 to-indigo-600' 
                      : 'bg-white/20'
                  } group-hover:shadow-lg`}
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.6 }}
                >
                  {renderLogoContent()}
                </motion.div>
                <div className="absolute -inset-1 bg-gradient-to-r from-sky-500 to-indigo-600 rounded-2xl blur opacity-0 group-hover:opacity-20 transition-opacity"></div>
              </div>
              <div className="hidden sm:block">
                <motion.h1 
                  className={`font-bold text-xl leading-tight ${
                    scrolled ? 'text-gray-900 dark:text-white' : 'text-white'
                  }`}
                  whileHover={{ x: 2 }}
                >
                  {isChatPage ? 'Chat Với AI' : 'Hein AI'}
                </motion.h1>
                <p className={`text-xs leading-tight ${
                  scrolled ? 'text-gray-600 dark:text-gray-400' : 'text-white/90'
                }`}>
                  {isChatPage ? 'Trò chuyện thông minh' : 'AI không giới hạn'}
                </p>
              </div>
            </motion.button>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => (isChatPage ? toHome() : toChat())}
              className={`flex items-center gap-2 font-semibold px-4 py-2.5 rounded-xl transition-all ${
                scrolled
                  ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'text-white hover:bg-white/20'
              }`}
            >
              {renderChatHomeIcon()}
              <span className="hidden lg:inline">{isChatPage ? 'Trang Chủ' : 'Chat AI'}</span>
            </motion.button>

            <motion.button 
              whileHover={{ scale: 1.05, rotate: 180 }}
              whileTap={{ scale: 0.95 }}
              onClick={toggleTheme} 
              aria-label="Chuyển giao diện" 
              className={`p-2.5 rounded-xl transition-all ${
                scrolled
                  ? 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'hover:bg-white/20'
              }`}
            >
              {currentTheme === 'light' 
                ? <Moon className={`w-5 h-5 ${scrolled ? 'text-gray-700 dark:text-gray-300' : 'text-white'}`} /> 
                : <Sun className={`w-5 h-5 ${scrolled ? 'text-gray-700 dark:text-gray-300' : 'text-white'}`} />
              }
            </motion.button>

            {/* User Dropdown */}
            <div className="relative">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setDropdownOpen((s) => !s)}
                className={`flex items-center gap-3 px-4 py-2 rounded-xl transition-all ${
                  scrolled
                    ? 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                    : 'bg-white/20 hover:bg-white/30'
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold ${
                  scrolled
                    ? 'bg-gradient-to-br from-sky-500 to-indigo-600 text-white'
                    : 'bg-white/30 text-white'
                }`}>
                  {initials}
                </div>
                <span className={`text-sm font-medium truncate max-w-[8rem] ${
                  scrolled ? 'text-gray-900 dark:text-white' : 'text-white'
                }`}>
                  {userName || 'Người dùng'}
                </span>
              </motion.button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden z-50"
                  >
                    <div className="p-2">
                      <motion.button 
                        whileHover={{ x: 4, backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
                        onClick={() => { navigate('/profile'); setDropdownOpen(false); }} 
                        className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl transition-colors text-gray-700 dark:text-gray-300"
                      >
                        <User className="w-4 h-4" /> 
                        <span className="font-medium">Hồ sơ</span>
                      </motion.button>
                      <motion.button 
                        whileHover={{ x: 4, backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
                        onClick={() => { navigate('/settings'); setDropdownOpen(false); }} 
                        className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl transition-colors text-gray-700 dark:text-gray-300"
                      >
                        <Settings className="w-4 h-4" /> 
                        <span className="font-medium">Cài đặt</span>
                      </motion.button>
                      <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
                      <motion.button 
                        whileHover={{ x: 4, backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                        onClick={handleLogout} 
                        className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl text-red-600 dark:text-red-400 font-medium"
                      >
                        <LogOut className="w-4 h-4" /> 
                        Đăng xuất
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center gap-2">
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={toggleTheme} 
              aria-label="Chuyển giao diện" 
              className={`p-2 rounded-xl ${
                scrolled
                  ? 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'hover:bg-white/20'
              }`}
            >
              {currentTheme === 'light' 
                ? <Moon className={`w-5 h-5 ${scrolled ? 'text-gray-700 dark:text-gray-300' : 'text-white'}`} /> 
                : <Sun className={`w-5 h-5 ${scrolled ? 'text-gray-700 dark:text-gray-300' : 'text-white'}`} />
              }
            </motion.button>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setMenuOpen((s) => !s)} 
              className="p-2 rounded-xl"
            >
              {menuOpen 
                ? <X className={`w-6 h-6 ${scrolled ? 'text-gray-700 dark:text-gray-300' : 'text-white'}`} /> 
                : <Menu className={`w-6 h-6 ${scrolled ? 'text-gray-700 dark:text-gray-300' : 'text-white'}`} />
              }
            </motion.button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden mt-4 pt-4 border-t border-white/20"
            >
              <div className="flex flex-col gap-1">
                <motion.button 
                  whileHover={{ x: 4 }}
                  onClick={() => { isChatPage ? toHome() : toChat(); setMenuOpen(false); }} 
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                    scrolled
                      ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : 'text-white hover:bg-white/20'
                  }`}
                >
                  {renderChatHomeIcon()}
                  {isChatPage ? 'Trang Chủ' : 'Chat Với AI'}
                </motion.button>
                <motion.button 
                  whileHover={{ x: 4 }}
                  onClick={() => { navigate('/profile'); setMenuOpen(false); }} 
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                    scrolled
                      ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : 'text-white hover:bg-white/20'
                  }`}
                >
                  <User className="w-4 h-4" /> Hồ sơ
                </motion.button>
                <motion.button 
                  whileHover={{ x: 4 }}
                  onClick={() => { navigate('/settings'); setMenuOpen(false); }} 
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                    scrolled
                      ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : 'text-white hover:bg-white/20'
                  }`}
                >
                  <Settings className="w-4 h-4" /> Cài đặt
                </motion.button>
                <motion.button 
                  whileHover={{ x: 4 }}
                  onClick={handleLogout} 
                  className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Đăng xuất
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md" 
              onClick={cancelLogout}
            ></motion.div>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="relative bg-white dark:bg-gray-800 rounded-3xl p-6 max-w-md w-full shadow-2xl border border-gray-200 dark:border-gray-700"
            >
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Xác nhận đăng xuất</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Bạn có chắc chắn muốn đăng xuất? Tất cả phiên làm việc hiện tại sẽ kết thúc.
              </p>
              <div className="flex gap-3 justify-end">
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={cancelLogout} 
                  className="px-6 py-2.5 rounded-xl font-semibold bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white transition-colors"
                >
                  Hủy
                </motion.button>
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={confirmLogout} 
                  className="px-6 py-2.5 rounded-xl font-semibold bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg shadow-red-500/30 transition-all"
                >
                  Đăng xuất
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
