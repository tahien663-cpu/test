import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiService from './services/api';
import { 
  ArrowLeft, 
  Palette, 
  Shield, 
  Bell, 
  Globe, 
  Trash2, 
  Eye, 
  EyeOff,
  Check,
  Moon,
  Sun,
  Save
} from 'lucide-react';

export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('appearance');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [accent, setAccent] = useState(() => localStorage.getItem('accent') || 'blue');
  const [particles, setParticles] = useState(() => localStorage.getItem('particles') === 'true');
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('reducedMotion') === 'true');
  const [language, setLanguage] = useState(() => localStorage.getItem('language') || 'vi');
  const [notifications, setNotifications] = useState(() => localStorage.getItem('notifications') !== 'false');
  const [soundEffects, setSoundEffects] = useState(() => localStorage.getItem('soundEffects') !== 'false');

  // Security states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [twoFactor, setTwoFactor] = useState(() => localStorage.getItem('twoFactor') === 'true');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Messages
  const [message, setMessage] = useState({ text: '', type: '', section: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const colorMap = {
      blue: '#2563eb',
      purple: '#7c3aed',
      pink: '#db2777',
      emerald: '#10b981',
      orange: '#f97316',
      red: '#dc2626',
      cyan: '#06b6d4',
      yellow: '#eab308'
    };
    localStorage.setItem('accent', accent);
    root.style.setProperty('--accent', colorMap[accent] || '#2563eb');
  }, [accent]);

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ text: 'Vui lòng điền đầy đủ thông tin', type: 'error', section: 'password' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ text: 'Mật khẩu xác nhận không khớp', type: 'error', section: 'password' });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ text: 'Mật khẩu phải có ít nhất 6 ký tự', type: 'error', section: 'password' });
      return;
    }
    try {
      setSaving(true);
      const data = await apiService.changePassword({ currentPassword, newPassword });
      setMessage({ text: data.message, type: 'success', section: 'password' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage({ text: error.message || 'Không thể kết nối tới server', type: 'error', section: 'password' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') {
      setMessage({ text: 'Vui lòng nhập "DELETE" để xác nhận', type: 'error', section: 'delete' });
      return;
    }
    try {
      setSaving(true);
      await apiService.deleteAccount();
      localStorage.clear();
      navigate('/');
    } catch (error) {
      setMessage({ text: error.message || 'Không thể kết nối tới server', type: 'error', section: 'delete' });
    } finally {
      setSaving(false);
    }
  };

  const saveGeneralSettings = () => {
    localStorage.setItem('language', language);
    localStorage.setItem('notifications', String(notifications));
    localStorage.setItem('soundEffects', String(soundEffects));
    setMessage({ text: 'Cài đặt đã được lưu!', type: 'success', section: 'general' });
    setTimeout(() => setMessage({ text: '', type: '', section: '' }), 3000);
  };

  const tabs = [
    { id: 'appearance', label: 'Giao diện', icon: Palette },
    { id: 'security', label: 'Bảo mật', icon: Shield },
    { id: 'notifications', label: 'Thông báo', icon: Bell },
    { id: 'general', label: 'Chung', icon: Globe },
    { id: 'danger', label: 'Vùng nguy hiểm', icon: Trash2 }
  ];

  const accentColors = [
    { value: 'blue', color: 'bg-blue-500' },
    { value: 'purple', color: 'bg-purple-500' },
    { value: 'pink', color: 'bg-pink-500' },
    { value: 'emerald', color: 'bg-emerald-500' },
    { value: 'orange', color: 'bg-orange-500' },
    { value: 'red', color: 'bg-red-500' },
    { value: 'cyan', color: 'bg-cyan-500' },
    { value: 'yellow', color: 'bg-yellow-500' }
  ];

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'} transition-colors duration-300`}>
      {/* Header */}
      <div className={`${theme === 'dark' ? 'bg-gray-800/50' : 'bg-white'} backdrop-blur-lg border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/home')}
                className={`p-2 rounded-lg ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} transition-colors`}
              >
                <ArrowLeft className={`w-5 h-5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`} />
              </button>
              <h1 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                Cài đặt
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-64">
            <nav className="space-y-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    activeTab === tab.id
                      ? `${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'} text-blue-500`
                      : `${theme === 'dark' ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-50 text-gray-600'}`
                  }`}
                >
                  <tab.icon className="w-5 h-5" />
                  <span className="font-medium">{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1">
            <div className={`${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} rounded-2xl p-6 shadow-xl`}>
              {/* Appearance Tab */}
              {activeTab === 'appearance' && (
                <div className="space-y-6">
                  <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    Tùy chỉnh giao diện
                  </h2>

                  {/* Theme Toggle */}
                  <div className="space-y-3">
                    <label className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                      Chế độ hiển thị
                    </label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setTheme('light')}
                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all ${
                          theme === 'light'
                            ? 'border-blue-500 bg-blue-50 text-blue-600'
                            : 'border-gray-600 hover:border-gray-500'
                        }`}
                      >
                        <Sun className="w-5 h-5" />
                        <span>Sáng</span>
                      </button>
                      <button
                        onClick={() => setTheme('dark')}
                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all ${
                          theme === 'dark'
                            ? 'border-blue-500 bg-blue-950 text-blue-400'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <Moon className="w-5 h-5" />
                        <span>Tối</span>
                      </button>
                    </div>
                  </div>

                  {/* Accent Color */}
                  <div className="space-y-3">
                    <label className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                      Màu chủ đạo
                    </label>
                    <div className="grid grid-cols-8 gap-2">
                      {accentColors.map(color => (
                        <button
                          key={color.value}
                          onClick={() => setAccent(color.value)}
                          className={`w-10 h-10 rounded-lg ${color.color} relative transition-transform hover:scale-110 ${
                            accent === color.value ? 'ring-2 ring-offset-2 ring-blue-500' : ''
                          }`}
                        >
                          {accent === color.value && (
                            <Check className="w-5 h-5 text-white absolute inset-0 m-auto" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Visual Effects */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                          Hiệu ứng hạt
                        </p>
                        <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                          Hiển thị các hạt động trên nền
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setParticles(!particles);
                          localStorage.setItem('particles', String(!particles));
                        }}
                        className={`relative w-14 h-7 rounded-full transition-colors ${
                          particles ? 'bg-blue-500' : 'bg-gray-400'
                        }`}
                      >
                        <div className={`absolute w-5 h-5 bg-white rounded-full top-1 transition-transform ${
                          particles ? 'translate-x-8' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                          Giảm chuyển động
                        </p>
                        <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                          Tắt hoạt ảnh cho hiệu suất tốt hơn
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setReducedMotion(!reducedMotion);
                          localStorage.setItem('reducedMotion', String(!reducedMotion));
                        }}
                        className={`relative w-14 h-7 rounded-full transition-colors ${
                          reducedMotion ? 'bg-blue-500' : 'bg-gray-400'
                        }`}
                      >
                        <div className={`absolute w-5 h-5 bg-white rounded-full top-1 transition-transform ${
                          reducedMotion ? 'translate-x-8' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Security Tab */}
              {activeTab === 'security' && (
                <div className="space-y-6">
                  <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    Bảo mật tài khoản
                  </h2>

                  {/* Change Password */}
                  <div className="space-y-4">
                    <h3 className={`font-semibold ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                      Đổi mật khẩu
                    </h3>
                    {message.section === 'password' && (
                      <div className={`p-3 rounded-lg ${
                        message.type === 'success' 
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                        {message.text}
                      </div>
                    )}

                    <div className="relative">
                      <input
                        type={showCurrentPassword ? 'text' : 'password'}
                        placeholder="Mật khẩu hiện tại"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className={`w-full px-4 py-3 pr-12 rounded-lg ${
                          theme === 'dark' 
                            ? 'bg-gray-700 text-white placeholder-gray-400' 
                            : 'bg-gray-100 text-gray-900 placeholder-gray-500'
                        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className={`absolute right-3 top-3.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
                      >
                        {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>

                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        placeholder="Mật khẩu mới"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={`w-full px-4 py-3 pr-12 rounded-lg ${
                          theme === 'dark' 
                            ? 'bg-gray-700 text-white placeholder-gray-400' 
                            : 'bg-gray-100 text-gray-900 placeholder-gray-500'
                        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className={`absolute right-3 top-3.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
                      >
                        {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>

                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Xác nhận mật khẩu mới"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`w-full px-4 py-3 pr-12 rounded-lg ${
                          theme === 'dark' 
                            ? 'bg-gray-700 text-white placeholder-gray-400' 
                            : 'bg-gray-100 text-gray-900 placeholder-gray-500'
                        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className={`absolute right-3 top-3.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
                      >
                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>

                    <button
                      onClick={handlePasswordChange}
                      disabled={saving}
                      className={`px-6 py-3 rounded-lg font-medium transition-all ${
                        saving 
                          ? 'bg-gray-500 cursor-not-allowed'
                          : 'bg-blue-500 hover:bg-blue-600'
                      } text-white`}
                    >
                      {saving ? 'Đang xử lý...' : 'Đổi mật khẩu'}
                    </button>
                  </div>

                  {/* Two Factor */}
                  <div className={`flex items-center justify-between p-4 rounded-lg border ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div>
                      <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                        Xác thực 2 yếu tố
                      </p>
                      <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        Tăng cường bảo mật cho tài khoản
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setTwoFactor(!twoFactor);
                        localStorage.setItem('twoFactor', String(!twoFactor));
                      }}
                      className={`relative w-14 h-7 rounded-full transition-colors ${
                        twoFactor ? 'bg-blue-500' : 'bg-gray-400'
                      }`}
                    >
                      <div className={`absolute w-5 h-5 bg-white rounded-full top-1 transition-transform ${
                        twoFactor ? 'translate-x-8' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                </div>
              )}

              {/* Notifications Tab */}
              {activeTab === 'notifications' && (
                <div className="space-y-6">
                  <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    Cài đặt thông báo
                  </h2>

                  <div className="space-y-4">
                    <div className={`flex items-center justify-between p-4 rounded-lg border ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
                      <div>
                        <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                          Thông báo từ hệ thống
                        </p>
                        <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                          Nhận thông báo về cập nhật và tin tức
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setNotifications(!notifications);
                          localStorage.setItem('notifications', String(!notifications));
                        }}
                        className={`relative w-14 h-7 rounded-full transition-colors ${
                          notifications ? 'bg-blue-500' : 'bg-gray-400'
                        }`}
                      >
                        <div className={`absolute w-5 h-5 bg-white rounded-full top-1 transition-transform ${
                          notifications ? 'translate-x-8' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    <div className={`flex items-center justify-between p-4 rounded-lg border ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
                      <div>
                        <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                          Âm thanh
                        </p>
                        <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                          Phát âm thanh khi có thông báo
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSoundEffects(!soundEffects);
                          localStorage.setItem('soundEffects', String(!soundEffects));
                        }}
                        className={`relative w-14 h-7 rounded-full transition-colors ${
                          soundEffects ? 'bg-blue-500' : 'bg-gray-400'
                        }`}
                      >
                        <div className={`absolute w-5 h-5 bg-white rounded-full top-1 transition-transform ${
                          soundEffects ? 'translate-x-8' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* General Tab */}
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    Cài đặt chung
                  </h2>

                  {message.section === 'general' && (
                    <div className="p-3 rounded-lg bg-green-500/20 text-green-400 border border-green-500/30">
                      {message.text}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                        Ngôn ngữ
                      </label>
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className={`w-full mt-2 px-4 py-3 rounded-lg ${
                          theme === 'dark' 
                            ? 'bg-gray-700 text-white' 
                            : 'bg-gray-100 text-gray-900'
                        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      >
                        <option value="vi">Tiếng Việt</option>
                        <option value="en">English</option>
                        <option value="zh">中文</option>
                        <option value="ja">日本語</option>
                      </select>
                    </div>

                    <button
                      onClick={saveGeneralSettings}
                      className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                      <Save className="w-5 h-5" />
                      Lưu cài đặt
                    </button>
                  </div>
                </div>
              )}

              {/* Danger Zone */}
              {activeTab === 'danger' && (
                <div className="space-y-6">
                  <h2 className={`text-xl font-bold mb-4 text-red-500`}>
                    Vùng nguy hiểm
                  </h2>

                  <div className={`p-4 rounded-lg border-2 border-red-500/30 ${theme === 'dark' ? 'bg-red-950/20' : 'bg-red-50'}`}>
                    <h3 className="font-semibold text-red-500 mb-2">Xóa tài khoản</h3>
                    <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      Hành động này không thể hoàn tác. Tất cả dữ liệu của bạn sẽ bị xóa vĩnh viễn.
                    </p>

                    {message.section === 'delete' && (
                      <div className="mb-4 p-3 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30">
                        {message.text}
                      </div>
                    )}

                    <button
                      onClick={() => setShowDeleteModal(true)}
                      className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
                    >
                      Xóa tài khoản
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className={`${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} rounded-2xl p-6 max-w-md w-full`}>
            <h3 className={`text-xl font-bold mb-4 text-red-500`}>
              Xác nhận xóa tài khoản
            </h3>
            <p className={`mb-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Nhập "DELETE" để xác nhận xóa tài khoản. Hành động này không thể hoàn tác.
            </p>
            <input
              type="text"
              placeholder="Nhập DELETE"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg mb-4 ${
                theme === 'dark' 
                  ? 'bg-gray-700 text-white placeholder-gray-400' 
                  : 'bg-gray-100 text-gray-900 placeholder-gray-500'
              } focus:outline-none focus:ring-2 focus:ring-red-500`}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirm('');
                }}
                className={`flex-1 px-4 py-2 rounded-lg font-medium ${
                  theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                } transition-colors`}
              >
                Hủy
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirm !== 'DELETE' || saving}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  deleteConfirm === 'DELETE' && !saving
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-gray-400 cursor-not-allowed text-gray-200'
                }`}
              >
                {saving ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}