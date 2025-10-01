import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Send, Bot, User, Loader2, Menu, Plus, Search, Settings, Moon, Sun, Trash2, MessageSquare, X, 
  Image, Globe, Mic, StopCircle, Home
} from 'lucide-react';
import DOMPurify from 'dompurify';
import apiService from './services/api';

// ==================== UTILITIES ====================
const parseMarkdown = (text) => {
  if (!text || typeof text !== 'string') return '';
  
  try {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
        const langClass = lang ? ` language-${lang}` : '';
        return `<div class="my-3 relative group"><pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl overflow-x-auto text-sm"><code class="${langClass} text-gray-900 dark:text-gray-100">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre><button class="copy-btn absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition-all" data-code="${code.trim().replace(/"/g, '&quot;')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button></div>`;
      })
      .replace(/`([^`]+)`/g, '<code class="px-2 py-0.5 bg-gray-200 dark:bg-gray-800 rounded text-sm font-mono text-gray-900 dark:text-gray-100">$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>')
      .replace(/__(.*?)__/g, '<strong class="font-bold">$1</strong>')
      .replace(/\*([^\*]+)\*/g, '<em class="italic">$1</em>')
      .replace(/_([^_]+)_/g, '<em class="italic">$1</em>')
      .replace(/~~(.*?)~~/g, '<del class="line-through opacity-70">$1</del>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto rounded-xl my-3 shadow-lg" />')
      .replace(/\n/g, '<br>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline">$1</a>')
      .replace(/^(#{1,6})\s*(.*)$/gm, (match, level, content) => {
        const tag = `h${level.length}`;
        const size = 7 - level.length;
        return `<${tag} class="font-bold mt-4 mb-2 text-${size}xl text-gray-900 dark:text-white">${content}</${tag}>`;
      })
      .replace(/^[-*]\s+(.*)$/gm, '<li class="ml-4 list-disc text-gray-900 dark:text-white">$1</li>')
      .replace(/^\d+\.\s+(.*)$/gm, '<li class="ml-4 list-decimal text-gray-900 dark:text-white">$1</li>');

    return DOMPurify.sanitize(html, { 
      ALLOWED_TAGS: ['strong', 'em', 'del', 'a', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'p', 'div', 'button', 'img'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'src', 'alt', 'data-code']
    });
  } catch (err) {
    console.error('Markdown parse error:', err);
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Hôm nay';
  if (date.toDateString() === yesterday.toDateString()) return 'Hôm qua';
  
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
};

// ==================== COMPONENTS ====================
const MessageBubble = ({ msg, userName, onDelete, theme }) => {
  const isUser = msg.role === 'user';
  const contentRef = useRef(null);
  
  useEffect(() => {
    if (!contentRef.current) return;
    
    const handleCopy = (e) => {
      if (e.target.closest('.copy-btn')) {
        const btn = e.target.closest('.copy-btn');
        const code = btn.getAttribute('data-code');
        navigator.clipboard.writeText(code)
          .then(() => {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
            setTimeout(() => {
              btn.innerHTML = originalHTML;
            }, 2000);
          })
          .catch(err => console.error('Copy error:', err));
      }
    };
    
    contentRef.current.addEventListener('click', handleCopy);
    return () => contentRef.current?.removeEventListener('click', handleCopy);
  }, [msg.content]);
  
  return (
    <div className={`flex gap-3 mb-6 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}>
      <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${isUser ? 'bg-blue-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'} shadow-lg`}>
        {isUser ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
      </div>
      <div className={`max-w-[75%] md:max-w-[65%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`px-4 py-3 rounded-2xl ${isUser ? 'bg-blue-500 text-white rounded-tr-md' : theme === 'dark' ? 'bg-gray-800 text-white rounded-tl-md' : 'bg-gray-100 text-gray-900 rounded-tl-md'} shadow-md`}>
          <div 
            ref={contentRef}
            className="text-[15px] leading-relaxed prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }}
          />
        </div>
        <div className="flex items-center gap-2 mt-1.5 px-1">
          <span className="text-xs text-gray-400">{formatTime(msg.timestamp)}</span>
          {isUser && msg.id !== 'welcome' && (
            <button 
              onClick={() => onDelete(msg.id)}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ChatHistoryItem = ({ chat, isActive, onClick, onDelete, theme }) => (
  <div
    onClick={onClick}
    className={`p-3 rounded-xl cursor-pointer group transition-all ${isActive ? 'bg-blue-500/10 border border-blue-500/20' : theme === 'dark' ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquare className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
          <p className={`font-medium text-sm truncate ${isActive ? 'text-blue-500' : 'text-gray-900 dark:text-white'}`}>{chat.title || 'Cuộc trò chuyện mới'}</p>
        </div>
        <p className="text-xs text-gray-400 truncate pl-6">{chat.last_message || 'Không có tin nhắn'}</p>
      </div>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onDelete(chat.id);
        }}
        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded-lg transition-all"
      >
        <Trash2 className="w-4 h-4 text-red-500" />
      </button>
    </div>
  </div>
);

const Sidebar = ({ isOpen, onClose, theme, onThemeToggle, chatHistory, currentChatId, onChatSelect, onNewChat, onDeleteChat, searchTerm, onSearchChange, onHome, navigate }) => {
  const groupedChats = useMemo(() => {
    const groups = {};
    chatHistory.forEach(chat => {
      const date = formatDate(chat.created_at || chat.timestamp);
      if (!groups[date]) groups[date] = [];
      groups[date].push(chat);
    });
    return groups;
  }, [chatHistory]);

  return (
    <>
      <div className={`fixed inset-y-0 left-0 z-50 w-80 transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 ${theme === 'dark' ? 'bg-gray-950 border-r border-gray-800' : 'bg-gray-50 border-r border-gray-200'}`}>
        <div className="h-full flex flex-col">
          <div className={`p-4 border-b ${theme === 'dark' ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg">
                  <img src="/logo.png" alt="Hein AI Logo" className="w-9 h-9 object-contain" />
                </div>
                <span className="font-bold text-lg bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Hein AI</span>
              </div>
              <button 
                onClick={onClose}
                className={`lg:hidden p-2 rounded-lg transition ${theme === 'dark' ? 'hover:bg-gray-800 text-white' : 'hover:bg-gray-200 text-gray-900'}`}
              >
                <X className="w-5 h-5 text-gray-900 dark:text-white" />
              </button>
            </div>
            
            <button 
              onClick={onNewChat}
              className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
            >
              <Plus className="w-5 h-5" />
              <span className="font-medium">Cuộc trò chuyện mới</span>
            </button>
          </div>

          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Tìm kiếm..."
                className={`w-full pl-10 pr-4 py-2.5 rounded-xl ${theme === 'dark' ? 'bg-gray-800 text-white placeholder-gray-500 border border-gray-700' : 'bg-white text-gray-900 placeholder-gray-400 border border-gray-200'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 space-y-4">
            {Object.entries(groupedChats).map(([date, chats]) => (
              <div key={date}>
                <h3 className="text-xs font-semibold text-gray-400 mb-2 px-2">{date}</h3>
                <div className="space-y-1">
                  {chats.filter(chat => (chat.title || '').toLowerCase().includes(searchTerm.toLowerCase())).map(chat => (
                    <ChatHistoryItem
                      key={chat.id}
                      chat={chat}
                      isActive={currentChatId === chat.id}
                      onClick={() => onChatSelect(chat.id)}
                      onDelete={onDeleteChat}
                      theme={theme}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={`p-4 border-t ${theme === 'dark' ? 'border-gray-800' : 'border-gray-200'} space-y-1`}>
            <button 
              onClick={onHome}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-gray-800 text-white' : 'hover:bg-gray-200 text-gray-900'}`}
            >
              <Home className="w-5 h-5" />
              <span className="text-sm">Trang chủ</span>
            </button>
            <button 
              onClick={() => navigate('/settings')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-gray-800 text-white' : 'hover:bg-gray-200 text-gray-900'}`}
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm">Cài đặt</span>
            </button>
            <button 
              onClick={onThemeToggle}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-gray-800 text-white' : 'hover:bg-gray-200 text-gray-900'}`}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              <span className="text-sm">{theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối'}</span>
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
    </>
  );
};

// ==================== MAIN COMPONENT ====================
export default function Chat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'ai',
      content: 'Xin chào! Tôi là **Hein**! 😄',
      timestamp: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || 'Bạn');
  const [chatHistory, setChatHistory] = useState([]);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isLoadingHistoryRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Handle copy code button clicks
  useEffect(() => {
    const handleCopy = (e) => {
      if (e.target.classList.contains('copy-btn')) {
        const code = e.target.getAttribute('data-code');
        navigator.clipboard.writeText(code)
          .then(() => {
            const originalHTML = e.target.innerHTML;
            e.target.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
            setTimeout(() => {
              e.target.innerHTML = originalHTML;
            }, 2000);
          })
          .catch(err => console.error('Copy error:', err));
      }
    };

    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('click', handleCopy);
      return () => container.removeEventListener('click', handleCopy);
    }
  }, [messages]);

  // Load chat history
  const loadChatHistory = useCallback(async () => {
    if (isLoadingHistoryRef.current) return;
    
    try {
      isLoadingHistoryRef.current = true;
      const data = await apiService.getChatHistory();
      setChatHistory(data.history || []);
    } catch (err) {
      console.error('Load history error:', err);
      if (err.message.includes('401') || err.message.includes('403')) {
        localStorage.clear();
        navigate('/login');
      }
    } finally {
      isLoadingHistoryRef.current = false;
    }
  }, [navigate]);

  useEffect(() => {
    loadChatHistory();
  }, [loadChatHistory]);

  // Load specific chat
  const loadChat = useCallback((id) => {
    const selectedChat = chatHistory.find(chat => chat.id === id);
    if (selectedChat && selectedChat.messages) {
      setMessages(selectedChat.messages.length > 0 ? selectedChat.messages : [messages[0]]);
      setCurrentChatId(id);
    }
  }, [chatHistory, messages]);

  // Handle keydown
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [isLoading]);

  // Stop generation
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, []);

  // Handle send message
  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    
    if (input.length > 500) {
      setError('Tin nhắn quá dài (tối đa 500 ký tự)');
      return;
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      abortControllerRef.current = new AbortController();
      const data = await apiService.request('/chat', {
        method: 'POST',
        body: JSON.stringify({ 
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })), 
          chatId: currentChatId 
        }),
        signal: abortControllerRef.current.signal
      });

      const aiMessage = {
        id: data.messageId || `ai-${Date.now()}`,
        role: 'ai',
        content: data.message,
        timestamp: data.timestamp || new Date().toISOString()
      };

      setMessages(prev => [...prev, aiMessage]);
      
      if (data.chatId && !currentChatId) {
        setCurrentChatId(data.chatId);
      }
      
      await loadChatHistory();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Send message error:', err);
        const errorMsg = err.message.includes('401') || err.message.includes('403')
          ? 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.'
          : 'Không thể gửi tin nhắn. Vui lòng thử lại.';
        
        setError(errorMsg);
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: 'ai',
          content: `**Lỗi**: ${errorMsg}`,
          timestamp: new Date().toISOString()
        }]);

        if (err.message.includes('401') || err.message.includes('403')) {
          localStorage.clear();
          navigate('/login');
        }
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, currentChatId, messages, loadChatHistory, navigate]);

  // Handle web search
  const handleWebSearch = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    const searchInput = `Tìm kiếm web: ${input}`;
    setInput(searchInput);
    setTimeout(() => handleSendMessage(), 100);
  }, [input, isLoading, handleSendMessage]);

  // Handle generate image
  const handleGenerateImage = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    
    if (input.length > 500) {
      setError('Prompt quá dài (tối đa 500 ký tự)');
      return;
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Tạo ảnh: ${input.trim()}`,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    const promptToSend = input.trim();
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      abortControllerRef.current = new AbortController();
      const data = await apiService.request('/generate-image', {
        method: 'POST',
        body: JSON.stringify({ prompt: promptToSend, chatId: currentChatId }),
        signal: abortControllerRef.current.signal
      });

      console.log('Image API Response:', data);

      if (!data.imageUrl) {
        throw new Error('No image URL returned from API');
      }

      const aiMessage = {
        id: data.messageId || `ai-${Date.now()}`,
        role: 'ai',
        content: data.message || `![Generated Image](${data.imageUrl})`,
        timestamp: data.timestamp || new Date().toISOString()
      };

      setMessages(prev => [...prev, aiMessage]);
      
      if (data.chatId && !currentChatId) {
        setCurrentChatId(data.chatId);
      }
      
      await loadChatHistory();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Generate image error:', err);
        const errorMsg = err.message.includes('401') || err.message.includes('403')
          ? 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.'
          : `Không thể tạo ảnh: ${err.message}`;
        
        setError(errorMsg);
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: 'ai',
          content: `**Lỗi**: ${errorMsg}`,
          timestamp: new Date().toISOString()
        }]);

        if (err.message.includes('401') || err.message.includes('403')) {
          localStorage.clear();
          navigate('/login');
        }
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, currentChatId, loadChatHistory, navigate]);

  // Delete chat
  const deleteChat = useCallback(async (id) => {
    if (!window.confirm('Bạn có chắc muốn xóa cuộc trò chuyện này?')) return;

    try {
      await apiService.deleteChat(id);
      setChatHistory(prev => prev.filter(chat => chat.id !== id));
      if (currentChatId === id) {
        setCurrentChatId(null);
        setMessages([messages[0]]);
      }
    } catch (err) {
      console.error('Delete chat error:', err);
      setError('Không thể xóa cuộc trò chuyện. Vui lòng thử lại.');
    }
  }, [currentChatId, messages]);

  // Delete message
  const deleteMessage = useCallback(async (messageId) => {
    try {
      await apiService.deleteMessage(messageId);
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
      await loadChatHistory();
    } catch (err) {
      console.error('Delete message error:', err);
      setError('Không thể xóa tin nhắn. Vui lòng thử lại.');
    }
  }, [loadChatHistory]);

  // New chat
  const newChat = useCallback(() => {
    setCurrentChatId(null);
    setMessages([{
      id: 'welcome',
      role: 'ai',
      content: 'Xin chào! Tôi là **Hein**! 😄',
      timestamp: new Date().toISOString()
    }]);
    setError(null);
    setInput('');
    setSidebarOpen(false);
  }, []);

  // Toggle theme
  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  }, [theme]);

  // Handle home
  const handleHome = useCallback(() => {
    navigate('/home');
    setSidebarOpen(false);
  }, [navigate]);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Theme effect
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Auto-resize textarea
  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  }, []);

  const filteredHistory = useMemo(() => 
    chatHistory.filter(chat =>
      (chat.title || '').toLowerCase().includes(searchTerm.toLowerCase())
    ), [chatHistory, searchTerm]
  );

  const handleChatSelect = useCallback((chatId) => {
    loadChat(chatId);
    setSidebarOpen(false);
  }, [loadChat]);

  return (
    <div className={`h-screen flex ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'} text-gray-900 dark:text-white transition-colors duration-300`}>
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onThemeToggle={toggleTheme}
        chatHistory={filteredHistory}
        currentChatId={currentChatId}
        onChatSelect={handleChatSelect}
        onNewChat={newChat}
        onDeleteChat={deleteChat}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onHome={handleHome}
        navigate={navigate}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <nav className={`lg:hidden flex items-center justify-between p-4 border-b ${theme === 'dark' ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
          <button 
            onClick={() => setSidebarOpen(true)}
            className={`p-2 rounded-lg transition ${theme === 'dark' ? 'hover:bg-gray-800 text-white' : 'hover:bg-gray-200 text-gray-900'}`}
          >
            <Menu className="w-6 h-6 text-gray-900 dark:text-white" />
          </button>
          <h1 className="font-bold text-lg bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Hein AI</h1>
          <button 
            onClick={() => {
              localStorage.clear();
              navigate('/login');
            }}
            className="px-4 py-2 rounded-lg bg-red-500/70 hover:bg-red-600/70 text-white font-semibold transition-colors"
          >
            Đăng xuất
          </button>
        </nav>

        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            {error && (
              <div className={`p-4 rounded-2xl mb-6 flex items-center justify-between ${theme === 'dark' ? 'bg-red-900/30 text-red-300' : 'bg-red-100 text-red-700'}`}>
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-4 text-red-500 hover:text-red-700">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {messages.map(msg => (
              <MessageBubble 
                key={msg.id} 
                msg={msg} 
                userName={userName}
                onDelete={deleteMessage}
                theme={theme}
              />
            ))}
            {isLoading && (
              <div className="flex gap-3 mb-6">
                <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className={`px-4 py-3 rounded-2xl rounded-tl-md shadow-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}>
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Đang xử lý...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className={`border-t ${theme === 'dark' ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'} p-4 lg:p-6`}>
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Nhập tin nhắn của bạn..."
                className={`w-full px-4 py-3.5 pr-32 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${theme === 'dark' ? 'bg-gray-800 text-white placeholder-gray-500' : 'bg-gray-100 text-gray-900 placeholder-gray-400'} border-0 min-h-[3rem] max-h-[12rem]`}
                disabled={isLoading}
                rows={1}
              />
              
              <div className="absolute right-2 bottom-2 flex items-center gap-1">
                <button 
                  onClick={handleWebSearch}
                  className={`p-2 rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-200 text-gray-900'} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="Tìm kiếm web"
                  disabled={isLoading || !input.trim()}
                >
                  <Globe className="w-5 h-5" />
                </button>
                <button 
                  onClick={handleGenerateImage}
                  className={`p-2 rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-200 text-gray-900'} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="Tạo ảnh"
                  disabled={isLoading || !input.trim()}
                >
                  <Image className="w-5 h-5" />
                </button>
                <button 
                  className={`p-2 rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-200 text-gray-900'} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="Ghi âm"
                  disabled={isLoading}
                >
                  <Mic className="w-5 h-5" />
                </button>
                {isLoading ? (
                  <button
                    onClick={stopGeneration}
                    className="p-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white transition-all"
                    title="Dừng"
                  >
                    <StopCircle className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    onClick={handleSendMessage}
                    disabled={!input.trim()}
                    className={`p-2.5 rounded-xl transition-all ${input.trim() ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105' : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                    title="Gửi (Enter)"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-between mt-2 text-xs text-gray-400 px-2">
              <span>Enter để gửi • Shift+Enter để xuống dòng</span>
              <span className={input.length > 450 ? 'text-red-500 font-medium' : ''}>{input.length}/500</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
