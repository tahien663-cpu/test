import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from './Navbar'; // Thêm import
import apiService from './services/api';
import { ArrowLeft, User, Mail, Calendar, Edit3, Save, X } from 'lucide-react';

export default function Profile() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark'); // Thêm theme
  const [userName, setUserName] = useState(localStorage.getItem('userName') || '');
  const [userEmail, setUserEmail] = useState(localStorage.getItem('userEmail') || '');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(userName);
  const [editEmail, setEditEmail] = useState(userEmail);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Theme effect
  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const handleSave = async () => {
    if (!editName.trim() || !editEmail.trim()) {
      setMessage({ text: 'Vui lòng điền đầy đủ thông tin', type: 'error' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(editEmail)) {
      setMessage({ text: 'Email không hợp lệ', type: 'error' });
      return;
    }

    try {
      setIsSaving(true);
      const data = await apiService.updateProfile({
        name: editName.trim(),
        email: editEmail.trim()
      });

      setMessage({ text: data.message, type: 'success' });
      localStorage.setItem('userName', editName);
      localStorage.setItem('userEmail', editEmail);
      setUserName(editName);
      setUserEmail(editEmail);
      setIsEditing(false);
    } catch (error) {
      setMessage({ 
        text: error.message || 'Không thể kết nối tới server', 
        type: 'error' 
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(userName);
    setEditEmail(userEmail);
    setIsEditing(false);
    setMessage({ text: '', type: '' });
  };

  return (
    <div className={`min-h-screen flex flex-col ${theme === 'light' ? 'bg-gray-50' : 'bg-gray-900'} transition-colors duration-300`}>
      <Navbar isChatPage={false} theme={theme} setTheme={setTheme} />
      <div className="flex-1 pt-20"> {/* Thêm pt-20 cho Navbar */}
        {/* Header */}
        <div className={`${theme === 'light' ? 'bg-white' : 'bg-gray-800/50'} backdrop-blur-lg border-b ${theme === 'light' ? 'border-gray-200' : 'border-gray-700'}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => navigate('/home')}
                  className={`p-2 rounded-lg transition-colors ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
                >
                  <ArrowLeft className={`w-5 h-5 ${theme === 'light' ? 'text-gray-600' : 'text-gray-300'}`} />
                </button>
                <h1 className={`text-2xl font-bold ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>
                  Hồ sơ cá nhân
                </h1>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-gray-800'} rounded-2xl p-8 shadow-xl`}>
            {/* Profile Header */}
            <div className="text-center mb-8">
              <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center text-3xl font-bold mb-4 ${
                theme === 'light' ? 'bg-blue-100 text-blue-600' : 'bg-blue-600 text-white'
              }`}>
                {userName ? userName.charAt(0).toUpperCase() : 'U'}
              </div>
              <h2 className={`text-2xl font-bold ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>
                {userName || 'Người dùng'}
              </h2>
              <p className={`${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
                {userEmail || 'Chưa có email'}
              </p>
            </div>

            {/* Message */}
            {message.text && (
              <div className={`mb-6 p-4 rounded-lg ${
                message.type === 'success'
                  ? (theme === 'light' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-green-500/20 text-green-400 border border-green-500/30')
                  : (theme === 'light' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-red-500/20 text-red-400 border border-red-500/30')
              }`}>
                {message.type === 'success' ? '✅' : '❌'} {message.text}
              </div>
            )}

            {/* Profile Information */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>
                  Thông tin cá nhân
                </h3>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                      theme === 'light' 
                        ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    <Edit3 className="w-4 h-4" />
                    Chỉnh sửa
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Name */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>
                    <User className="inline w-4 h-4 mr-2" />
                    Họ và tên
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={`w-full px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        theme === 'light' 
                          ? 'bg-gray-100 text-gray-900 placeholder-gray-500' 
                          : 'bg-gray-700 text-white placeholder-gray-400'
                      }`}
                      placeholder="Nhập họ và tên"
                    />
                  ) : (
                    <div className={`px-4 py-3 rounded-lg ${
                      theme === 'light' ? 'bg-gray-100 text-gray-900' : 'bg-gray-700 text-white'
                    }`}>
                      {userName || 'Chưa có tên'}
                    </div>
                  )}
                </div>

                {/* Email */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>
                    <Mail className="inline w-4 h-4 mr-2" />
                    Email
                  </label>
                  {isEditing ? (
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className={`w-full px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        theme === 'light' 
                          ? 'bg-gray-100 text-gray-900 placeholder-gray-500' 
                          : 'bg-gray-700 text-white placeholder-gray-400'
                      }`}
                      placeholder="Nhập email"
                    />
                  ) : (
                    <div className={`px-4 py-3 rounded-lg ${
                      theme === 'light' ? 'bg-gray-100 text-gray-900' : 'bg-gray-700 text-white'
                    }`}>
                      {userEmail || 'Chưa có email'}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              {isEditing && (
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={handleCancel}
                    className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                      theme === 'light' 
                        ? 'bg-gray-300 hover:bg-gray-400 text-gray-800' 
                        : 'bg-gray-600 hover:bg-gray-700 text-white'
                    }`}
                  >
                    <X className="w-4 h-4" />
                    Hủy
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                      isSaving 
                        ? 'bg-gray-400 cursor-not-allowed text-white'
                        : theme === 'light' 
                          ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Đang lưu...' : 'Lưu'}
                  </button>
                </div>
              )}
            </div>

            {/* Account Info */}
            <div className={`mt-8 pt-6 border-t ${theme === 'light' ? 'border-gray-200' : 'border-gray-700'}`}>
              <h3 className={`text-lg font-semibold mb-4 ${theme === 'light' ? 'text-gray-900' : 'text-white'}`}>
                Thông tin tài khoản
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`${theme === 'light' ? 'bg-gray-50' : 'bg-gray-700'} p-4 rounded-lg`}>
                  <div className="flex items-center gap-3">
                    <Calendar className={`${theme === 'light' ? 'text-gray-600' : 'text-gray-400'} w-5 h-5`} />
                    <div>
                      <p className={`${theme === 'light' ? 'text-gray-600' : 'text-gray-400'} text-sm`}>Ngày tham gia</p>
                      <p className={`${theme === 'light' ? 'text-gray-900' : 'text-white'} font-medium`}>
                        {new Date().toLocaleDateString('vi-VN')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className={`${theme === 'light' ? 'bg-gray-50' : 'bg-gray-700'} p-4 rounded-lg`}>
                  <div className="flex items-center gap-3">
                    <User className={`${theme === 'light' ? 'text-gray-600' : 'text-gray-400'} w-5 h-5`} />
                    <div>
                      <p className={`${theme === 'light' ? 'text-gray-600' : 'text-gray-400'} text-sm`}>Trạng thái</p>
                      <p className={`${theme === 'light' ? 'text-green-600' : 'text-green-400'} font-medium`}>
                        Đang hoạt động
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}