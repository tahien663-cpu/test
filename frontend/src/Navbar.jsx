import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { Sun, Moon, Menu, X, User, LogOut, Home, MessageSquare } from 'lucide-react'; 
import { motion, AnimatePresence } from 'framer-motion';

const CUSTOM_LOGO_PATH = '/logo.png'; 

export default function Navbar({ isChatPage, theme: controlledTheme, setTheme: setControlledTheme }) {

  const navigate = useNavigate(); 
  
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [uncontrolledTheme, setUncontrolledTheme] = useState('light');
  const [userName, setUserName] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  // Thêm state để kiểm tra lỗi tải ảnh (tùy chọn)
  const [imageError, setImageError] = useState(false); 

  useEffect(() => {
    // SỬ DỤNG FIRESTORE CHO ỨNG DỤNG THỰC TẾ
    // Lưu ý: Trong môi trường thực, bạn nên dùng Firestore hoặc Context/Redux thay vì localStorage
    const name = localStorage.getItem('userName') || '';
    setUserName(name);
    if (controlledTheme == null) {
      const savedTheme = localStorage.getItem('theme') || 'dark';
      setUncontrolledTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }
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

  // Logic hiển thị icon thay thế nếu ảnh bị lỗi
  const renderLogoContent = () => {
    if (imageError) {
      // Dùng chữ cái hoặc icon dự phòng nếu ảnh lỗi
      // Tăng kích thước chữ H lên
      return <span className="text-white font-extrabold text-xl">H</span>;
    }
    
    return (
      <img
        src={CUSTOM_LOGO_PATH}
        alt="Logo Hein AI"
        className="w-15 h-15 object-contain" // Đã tăng kích thước ảnh
        onError={() => setImageError(true)} // Đặt state lỗi nếu không tải được ảnh
      />
    );
  };

  // Sửa lỗi "Objects are not valid as a React child" 
  // Lỗi xảy ra do đoạn này không có icon Lucide (MessageSquare đã bị loại bỏ import).
  // Tôi đã đưa MessageSquare vào lại import. 
  // Để tránh lỗi Object React Child, tôi đảm bảo icon được render đúng.
  const renderChatHomeIcon = () => {
    if (isChatPage) {
        return <Home className="inline-block mr-2 w-4 h-4" />;
    }
    // Dùng lại MessageSquare (đã import) thay vì chỉ dùng '💬'
    return <MessageSquare className="inline-block mr-2 w-4 h-4" />;
  };

  return (
    <>
      <nav className="fixed top-4 left-1/2 transform -translate-x-1/2 w-[calc(100%-2rem)] max-w-5xl bg-gradient-to-r from-sky-500/70 to-indigo-600/70 backdrop-blur-md border border-white/10 rounded-2xl shadow-xl px-4 py-3 z-50">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <motion.button
              initial={{ scale: 0.98 }}
              whileHover={{ scale: 1.02 }}
              onClick={() => navigate('/')}
              className="flex items-center gap-3 focus:outline-none"
            >
              {/* Đã tăng kích thước container (w-12 h-12) và xóa nền xanh (bg-white/20, border, backdrop-blur) */}
              {/* Đã thay đổi rounded-xl thành rounded-full để bo cong tròn hoàn toàn */}
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-transparent"> 
                {/* Đã thay thế SVG bằng component render logo */}
                {renderLogoContent()}
              </div>
              <div className="ml-1 text-left">
                <h1 className="text-white font-extrabold text-lg leading-tight">
                  {isChatPage ? 'Chat Với AI' : 'Hein'}
                </h1>
                <p className="text-white/80 text-xs -mt-1">{isChatPage ? 'Trò chuyện — Nhanh & Thông minh' : 'Nền tảng AI gọn nhẹ và unlimited'}</p>
              </div>
            </motion.button>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => (isChatPage ? toHome() : toChat())}
              className="text-white hover:text-white/95 font-semibold px-3 py-2 rounded-lg hover:bg-white/5 transition"
            >
              {/* SỬA LỖI OBJECT: Dùng hàm renderIcon đã được chuẩn hóa */}
              {renderChatHomeIcon()} 
              {isChatPage ? 'Trang Chủ' : 'Chat Với AI'}
            </button>

            <button onClick={toggleTheme} aria-label="Chuyển giao diện" className="p-2 rounded-lg hover:bg-white/5 transition">
              {currentTheme === 'light' ? <Moon className="w-5 h-5 text-white" /> : <Sun className="w-5 h-5 text-white" />}
            </button>

            <div className="relative">
              <button
                onClick={() => setDropdownOpen((s) => !s)}
                className="flex items-center gap-3 bg-white/5 hover:bg-white/6 px-3 py-1 rounded-xl focus:outline-none"
              >
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold text-white">{initials}</div>
                <div className="text-white text-sm truncate max-w-[8rem]">{userName || 'Người dùng'}</div>
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute right-0 mt-2 w-48 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-2 shadow-lg z-40"
                  >
                    <button onClick={() => { navigate('/profile'); setDropdownOpen(false); }} className="flex items-center gap-2 w-full text-left px-3 py-2 rounded hover:bg-white/3">
                      <User className="w-4 h-4" /> Hồ sơ
                    </button>
                    <button onClick={() => { navigate('/settings'); setDropdownOpen(false); }} className="flex items-center gap-2 w-full text-left px-3 py-2 rounded hover:bg-white/3">
                      ⚙️ Cài đặt
                    </button>
                    <div className="border-t border-white/6 my-1"></div>
                    <button onClick={handleLogout} className="flex items-center gap-2 w-full text-left px-3 py-2 rounded hover:bg-red-600/20 text-red-400">
                      <LogOut className="w-4 h-4" /> Đăng xuất
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="md:hidden flex items-center gap-2">
            <button onClick={toggleTheme} aria-label="Chuyển giao diện" className="p-2 rounded-lg hover:bg-white/5 focus:outline-none">
              {currentTheme === 'light' ? <Moon className="w-5 h-5 text-white" /> : <Sun className="w-5 h-5 text-white" />}
            </button>
            <button onClick={() => setMenuOpen((s) => !s)} className="p-2 rounded-lg focus:outline-none">
              {menuOpen ? <X className="w-6 h-6 text-white" /> : <Menu className="w-6 h-6 text-white" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden mt-3"
            >
              <div className="flex flex-col gap-2">
                <button onClick={() => { isChatPage ? toHome() : toChat(); setMenuOpen(false); }} className="text-white hover:bg-white/5 px-3 py-2 rounded-lg flex items-center gap-2">
                  <Home className="w-4 h-4" /> {isChatPage ? 'Trang Chủ' : 'Chat Với AI'}
                </button>
                <button onClick={() => { navigate('/profile'); setMenuOpen(false); }} className="text-white hover:bg-white/5 px-3 py-2 rounded-lg flex items-center gap-2">
                  <User className="w-4 h-4" /> Hồ sơ
                </button>
                <button onClick={() => { navigate('/settings'); setMenuOpen(false); }} className="text-white hover:bg-white/5 px-3 py-2 rounded-lg flex items-center gap-2">
                  ⚙️ Cài đặt
                </button>
                <button onClick={handleLogout} className="text-red-400 hover:bg-red-600/10 px-3 py-2 rounded-lg flex items-center gap-2">
                  <LogOut className="w-4 h-4" /> Đăng xuất
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <AnimatePresence>
        {showConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={cancelLogout}></div>
            <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.98, opacity: 0 }} className="relative bg-white/6 backdrop-blur-md border border-white/10 rounded-2xl p-5 max-w-sm w-full shadow-lg">
              <h3 className="text-lg font-semibold text-white">Xác nhận đăng xuất</h3>
              <p className="text-white/80 mt-2">Bạn có chắc chắn muốn đăng xuất khỏi tài khoản này? Các phiên làm việc sẽ bị kết thúc.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={cancelLogout} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/6 text-white">Hủy</button>
                <button onClick={confirmLogout} className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold">Đăng xuất</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
