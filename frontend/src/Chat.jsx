import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Send, Bot, User, Loader2, Menu, Plus, MessageSquare, 
  Search, Settings, Moon, Sun, Trash2, Home, Bold, Italic, Code, 
  Globe, StopCircle, RefreshCw, Image, ChevronDown
} from 'lucide-react';
import DOMPurify from 'dompurify';

const ImageMessage = ({ src, alt, onLoad, onError }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-lg">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className="max-w-full rounded-lg shadow-lg"
        onLoad={() => {
          setIsLoading(false);
          if (onLoad) onLoad();
        }}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
          if (onError) onError();
        }}
        style={{ display: isLoading || hasError ? 'none' : 'block' }}
      />
      {hasError && <p className="text-red-500 text-sm">Lỗi tải ảnh. 😔</p>}
    </div>
  );
};

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || 'Bạn');
  const [chatHistory, setChatHistory] = useState([]);
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const dropdownRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowActionDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle copy code button clicks
  useEffect(() => {
    const handleCopy = (e) => {
      if (e.target.classList.contains('copy-code-btn')) {
        const codeElement = e.target.previousSibling.querySelector('code');
        if (codeElement) {
          navigator.clipboard.writeText(codeElement.textContent)
            .then(() => {
              const originalText = e.target.textContent;
              e.target.textContent = 'Copied!';
              setTimeout(() => {
                e.target.textContent = originalText;
              }, 2000);
            })
            .catch(err => {
              console.error('Copy error:', err);
            });
        }
      }
    };

    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('click', handleCopy);
    }

    return () => {
      if (container) {
        container.removeEventListener('click', handleCopy);
      }
    };
  }, []);

  // Retry API call with exponential backoff
  const retryFetch = useCallback(async (url, options, maxRetries = 3, initialDelay = 1000) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        abortControllerRef.current = new AbortController();
        options.signal = abortControllerRef.current.signal;
        const response = await fetch(url, options);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        return response;
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log('Yêu cầu bị hủy');
          return null;
        }
        if (attempt === maxRetries) throw err;
        console.warn(`Retry ${attempt}/${maxRetries} for ${url}: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, attempt - 1)));
      }
    }
  }, []);

  // Enhanced markdown parser with error handling
  const parseMarkdown = useCallback((text) => {
    if (!text || typeof text !== 'string') return '';
    
    try {
      let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
          const langClass = lang ? ` language-${lang}` : '';
          return `<div class="relative my-2"><pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto shadow-sm"><code class="${langClass}">${code}</code></pre><button class="copy-code-btn absolute top-2 right-2 px-2 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors text-sm font-medium">Copy</button></div>`;
        })
        .replace(/`([^`]+)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm">$1</code>')
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>')
        .replace(/__(.*?)__/g, '<strong class="font-bold">$1</strong>')
        .replace(/(?<!\*)\*([^\*]+)\*(?!\*)/g, '<em class="italic">$1</em>')
        .replace(/(?<!_)_([^_]+)_(?!_)/g, '<em class="italic">$1</em>')
        .replace(/~~(.*?)~~/g, '<del class="line-through opacity-70">$1</del>')
        .replace(/\n/g, '<br>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline">$1</a>')
        .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>')
        .replace(/^\* (.*)$/gim, '<li class="ml-4">• $1</li>')
        .replace(/^- (.*)$/gim, '<li class="ml-4">• $1</li>')
        .replace(/^\d+\. (.*)$/gim, '<li class="ml-4 list-decimal">$1</li>')
        .replace(/^> (.*)$/gim, '<blockquote class="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic my-2">$1</blockquote>');
      return html;
    } catch (err) {
      console.error('Markdown parse error:', err.message);
      return text;
    }
  }, []);

  // Format message content
  const formatMessageContent = useCallback((content, role) => {
    if (!content) return '';
    if (role === 'ai' && content.includes('<img')) {
      const imgMatch = content.match(/<img\s+src="([^"]+)"\s+alt="([^"]+)"\s*\/?>/i);
      if (imgMatch) {
        return <ImageMessage src={imgMatch[1]} alt={imgMatch[2]} />;
      }
    }
    return parseMarkdown(content);
  }, [parseMarkdown]);

  // Insert markdown formatting
  const insertMarkdown = useCallback((before, after = '') => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    
    const newText = text.substring(0, start) + before + selectedText + after + text.substring(end);
    setInput(newText);
    
    setTimeout(() => {
      const newPosition = start + before.length + selectedText.length;
      textarea.focus();
      textarea.setSelectionRange(newPosition, newPosition);
    }, 0);
  }, []);

  const insertBold = useCallback(() => insertMarkdown('**', '**'), [insertMarkdown]);
  const insertItalic = useCallback(() => insertMarkdown('*', '*'), [insertMarkdown]);
  const insertCode = useCallback(() => insertMarkdown('`', '`'), [insertMarkdown]);

  // User initials
  const userInitials = useMemo(() => {
    return (userName || 'U')
      .split(' ')
      .filter(Boolean)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }, [userName]);

  // Generate message ID
  const generateMessageId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Format timestamp
  const formatTime = useCallback((timestamp) => {
    try {
      const now = new Date();
      const time = new Date(timestamp);
      if (isNaN(time.getTime())) return 'Vừa xong';
      
      const diffInHours = (now - time) / (1000 * 60 * 60);
      if (diffInHours < 24) {
        return time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      } else if (diffInHours < 48) {
        return 'Hôm qua';
      } else {
        return time.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      }
    } catch (error) {
      console.error('Error formatting time:', error);
      return 'Vừa xong';
    }
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Theme management
  useEffect(() => {
    try {
      localStorage.setItem('theme', theme);
      document.documentElement.classList.toggle('dark', theme === 'dark');
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  }, [theme]);

  // Load chat history
  useEffect(() => {
    const fetchChatHistory = async () => {
      let token;
      try {
        token = localStorage.getItem('token');
      } catch (error) {
        console.error('Error accessing token:', error);
        navigate('/login');
        return;
      }

      if (!token) {
        navigate('/login');
        return;
      }

      try {
        const response = await retryFetch('/api/chat/history', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response) return;

        let data;
        try {
          data = await response.json();
        } catch (jsonError) {
          console.error('JSON parse error in fetchChatHistory:', jsonError);
          return;
        }

        if (response.status === 403 || response.status === 401) {
          alert('Token hết hạn, đăng nhập lại nhé!');
          localStorage.removeItem('token');
          navigate('/login');
          return;
        }

        if (!response.ok) {
          console.error('Fetch history error:', data);
          throw new Error(data.error || 'Lỗi tải lịch sử chat');
        }

        setChatHistory((data.history || []).map(chat => ({
          ...chat,
          isActive: false
        })));
      } catch (err) {
        console.error('Load history error:', err.message);
      }
    };
    fetchChatHistory();
  }, [navigate, retryFetch]);

  // Load selected chat messages
  useEffect(() => {
    if (currentChatId && chatHistory.length > 0) {
      const chat = chatHistory.find(c => c.id === currentChatId);
      if (chat && chat.messages && chat.messages.length > 0) {
        setMessages(chat.messages);
      } else {
        setMessages([
          {
            id: `welcome-${currentChatId}`,
            role: 'ai',
            content: 'Tiếp tục cuộc trò chuyện này nhé! 😎',
            timestamp: new Date().toISOString()
          }
        ]);
      }
    }
  }, [currentChatId, chatHistory]);

  // Generic API call handler
  const handleApiCall = useCallback(async (endpoint, payload, userMessageContent = '') => {
    let token;
    try {
      token = localStorage.getItem('token');
    } catch (error) {
      console.error('Error accessing token:', error);
      alert('Lỗi truy cập token, vui lòng đăng nhập lại!');
      navigate('/login');
      return;
    }

    if (!token) {
      alert('Token hết hạn, vui lòng đăng nhập lại!');
      navigate('/login');
      return;
    }

    const userMessage = userMessageContent ? { 
      id: generateMessageId(),
      role: 'user', 
      content: userMessageContent, 
      timestamp: new Date().toISOString() 
    } : null;

    if (userMessage) {
      setMessages(prev => [...prev, userMessage]);
    }
    setInput('');
    setIsLoading(true);
    setShowActionDropdown(false);

    try {
      const recentMessages = userMessage ? 
        [...messages, userMessage].slice(-20) : 
        [...messages].slice(-20);
      
      const requestPayload = {
        messages: recentMessages,
        chatId: currentChatId,
        ...payload
      };
      
      const response = await retryFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response) {
        setMessages(prev => [...prev, {
          id: generateMessageId(),
          role: 'ai',
          content: 'Yêu cầu bị hủy. 😊',
          timestamp: new Date().toISOString()
        }]);
        return;
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('JSON parse error:', jsonError);
        throw new Error('Phản hồi từ server không hợp lệ. Vui lòng thử lại.');
      }

      if (response.status === 413) {
        throw new Error('Nội dung quá lớn. Hãy thử với tin nhắn ngắn hơn.');
      }

      if (response.status === 403 || response.status === 401) {
        alert('Token hết hạn, đăng nhập lại nhé!');
        localStorage.removeItem('token');
        navigate('/login');
        return;
      }

      if (!response.ok) {
        console.error('API error:', data);
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const aiMessage = { 
        id: data.messageId || generateMessageId(),
        role: 'ai', 
        content: data.message, 
        timestamp: data.timestamp || new Date().toISOString()
      };

      setMessages(prev => [...prev, aiMessage]);
      setCurrentChatId(data.chatId);

      // Update chat history
      setChatHistory(prev => {
        const existingChatIndex = prev.findIndex(chat => chat.id === data.chatId);
        const updatedMessages = userMessage ? 
          [...messages, userMessage, aiMessage] : 
          [...messages, aiMessage];
        
        const chatTitle = userMessage ? 
          userMessage.content.slice(0, 50) + (userMessage.content.length > 50 ? '...' : '') :
          'Cuộc trò chuyện';
        
        if (existingChatIndex !== -1) {
          const updatedChats = [...prev];
          updatedChats[existingChatIndex] = {
            ...updatedChats[existingChatIndex],
            lastMessage: data.message.slice(0, 50) + (data.message.length > 50 ? '...' : ''),
            timestamp: data.timestamp || new Date().toISOString(),
            messages: updatedMessages,
            isActive: true
          };
          updatedChats.forEach((chat, index) => {
            if (index !== existingChatIndex) chat.isActive = false;
          });
          return updatedChats;
        } else {
          const newChat = {
            id: data.chatId,
            title: chatTitle,
            lastMessage: data.message.slice(0, 50) + (data.message.length > 50 ? '...' : ''),
            timestamp: data.timestamp || new Date().toISOString(),
            isActive: true,
            messages: updatedMessages
          };
          return [newChat, ...prev.map(chat => ({ ...chat, isActive: false }))];
        }
      });
    } catch (error) {
      console.error('API Error:', error.message);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'ai',
        content: `**Ôi zời, lỗi rồi!** ${error.message}. Thử lại sau nhé? 😅`,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [messages, currentChatId, generateMessageId, navigate, retryFetch]);

  // Send message handler
  const handleSendMessage = useCallback(async (retry = false) => {
    const content = retry ? messages[messages.length - 1]?.content : input.trim();
    if (!content || isLoading) return;

    if (retry) {
      setIsLoading(true);
      await handleApiCall('/api/chat', {});
    } else {
      await handleApiCall('/api/chat', {}, content);
    }
  }, [input, isLoading, messages, handleApiCall]);

  // Web search handler
  const handleWebSearch = useCallback(async () => {
    const content = input.trim();
    if (!content || isLoading) return;
    
    const searchContent = content.startsWith('Search the web: ') ? content : `Search the web: ${content}`;
    await handleApiCall('/api/chat', {}, searchContent);
  }, [input, isLoading, handleApiCall]);

  // Generate image handler
  const handleGenerateImage = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isLoading) return;
    if (prompt.length > 500) {
      alert('Prompt quá dài! Vui lòng sử dụng tối đa 500 ký tự.');
      return;
    }

    await handleApiCall('/api/generate-image', { prompt }, prompt);
  }, [input, isLoading, handleApiCall]);

  // Handle stop request
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'ai',
        content: 'Đã dừng yêu cầu. 😊',
        timestamp: new Date().toISOString()
      }]);
    }
  }, [generateMessageId]);

  // Handle regenerate result
  const handleRegenerate = useCallback(() => {
    if (messages.length > 0 && !isLoading) {
      handleSendMessage(true);
    }
  }, [messages, isLoading, handleSendMessage]);

  // New chat handler
  const handleNewChat = useCallback(() => {
    let token;
    try {
      token = localStorage.getItem('token');
    } catch (error) {
      console.error('Error accessing token:', error);
      navigate('/login');
      return;
    }

    if (!token) {
      navigate('/login');
      return;
    }

    setCurrentChatId(null);
    setMessages([
      {
        id: `new-chat-${Date.now()}`,
        role: 'ai',
        content: '**Cuộc trò chuyện mới!** Hỏi gì đi nào? 😄',
        timestamp: new Date().toISOString()
      }
    ]);
    setChatHistory(prev => prev.map(chat => ({ ...chat, isActive: false })));
  }, [navigate]);

  // Select chat handler
  const handleSelectChat = useCallback((chatId) => {
    setChatHistory(prev => prev.map(chat => ({ ...chat, isActive: chat.id === chatId })));
    setCurrentChatId(chatId);
  }, []);

  // Delete chat handler
  const handleDeleteChat = useCallback(async (chatId) => {
    if (!confirm('Bạn có chắc muốn xóa cuộc trò chuyện này?')) return;

    let token;
    try {
      token = localStorage.getItem('token');
    } catch (error) {
      console.error('Error accessing token:', error);
      navigate('/login');
      return;
    }

    if (!token) {
      navigate('/login');
      return;
    }

    try {
      const response = await retryFetch(`/api/chat/${chatId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response) return;

      if (response.status === 403 || response.status === 401) {
        alert('Token hết hạn, đăng nhập lại nhé!');
        localStorage.removeItem('token');
        navigate('/login');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Delete chat error:', errorData);
        throw new Error(errorData.error || 'Lỗi xóa chat');
      }

      setChatHistory(prev => prev.filter(chat => chat.id !== chatId));
      
      if (chatId === currentChatId) {
        setCurrentChatId(null);
        setMessages([
          {
            id: `deleted-${Date.now()}`,
            role: 'ai',
            content: '**Chat đã xóa!** Tạo cuộc trò chuyện mới nhé? 😄',
            timestamp: new Date().toISOString()
          }
        ]);
      }
    } catch (err) {
      console.error('Delete chat error:', err.message);
      alert('Lỗi xóa chat, thử lại nhé!');
    }
  }, [currentChatId, navigate, retryFetch]);

  // Delete message handler
  const handleDeleteMessage = useCallback(async (messageId) => {
    if (messageId.startsWith('welcome') || messageId.startsWith('new-chat') || messageId.startsWith('deleted')) return;
    if (!confirm('Bạn có chắc muốn xóa tin nhắn này?')) return;

    let token;
    try {
      token = localStorage.getItem('token');
    } catch (error) {
      console.error('Error accessing token:', error);
      navigate('/login');
      return;
    }

    if (!token) {
      navigate('/login');
      return;
    }

    try {
      const response = await retryFetch(`/api/message/${messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response) return;

      if (response.status === 403 || response.status === 401) {
        alert('Token hết hạn, đăng nhập lại nhé!');
        localStorage.removeItem('token');
        navigate('/login');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Delete message error:', errorData);
        throw new Error(errorData.error || 'Lỗi xóa tin nhắn');
      }

      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } catch (err) {
      console.error('Delete message error:', err.message);
      alert('Lỗi xóa tin nhắn, thử lại nhé!');
    }
  }, [navigate, retryFetch]);

  // Filtered chats
  const filteredChats = useMemo(() => {
    return chatHistory.filter(chat => 
      (chat.title && chat.title.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (chat.lastMessage && chat.lastMessage.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [chatHistory, searchTerm]);

  // Input keydown handler
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSendMessage();
    }
    
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      switch (e.key) {
        case 'b':
          e.preventDefault();
          insertBold();
          break;
        case 'i':
          e.preventDefault();
          insertItalic();
          break;
        case '`':
          e.preventDefault();
          insertCode();
          break;
        default:
          break;
      }
    }
  }, [handleSendMessage, isLoading, insertBold, insertItalic, insertCode]);

  const goToHome = useCallback(() => navigate('/home'), [navigate]);
  const toggleTheme = useCallback(() => setTheme(prev => prev === 'light' ? 'dark' : 'light'), []);
  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);

  return (
    <div className={`flex h-screen ${theme === 'light' ? 'bg-gray-50 text-gray-900' : 'bg-gray-900 text-white'}`}>
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-80' : 'w-0'} transition-all duration-300 ${theme === 'light' ? 'bg-white border-gray-200 text-gray-900' : 'bg-gray-800 border-gray-700 text-white'} border-r flex flex-col overflow-hidden`}>
        <div className={`p-4 border-b ${theme === 'light' ? 'border-gray-200' : 'border-gray-700'}`}>
          <button
            onClick={goToHome}
            className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors mb-3 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
          >
            <Home className="w-5 h-5" />
            <span>Trang chủ</span>
          </button>
          <button
            onClick={handleNewChat}
            className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${theme === 'light' ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            <Plus className="w-5 h-5" />
            <span>Cuộc trò chuyện mới</span>
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Tìm kiếm..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 rounded-lg border ${theme === 'light' ? 'bg-gray-100 border-gray-300' : 'bg-gray-700 border-gray-600 text-white'}`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredChats.map((chat) => (
            <div
              key={chat.id}
              className={`p-3 rounded-lg cursor-pointer relative group ${chat.isActive ? (theme === 'light' ? 'bg-blue-100 text-blue-900' : 'bg-blue-900 text-blue-200') : (theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700')}`}
              onClick={() => handleSelectChat(chat.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <MessageSquare className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{chat.title || 'Cuộc trò chuyện'}</p>
                    <p className="text-sm text-gray-500 truncate">{chat.lastMessage || 'Không có tin nhắn'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{formatTime(chat.timestamp)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChat(chat.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={`p-4 border-t ${theme === 'light' ? 'border-gray-200' : 'border-gray-700'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${theme === 'light' ? 'bg-blue-100 text-blue-700' : 'bg-blue-900 text-blue-200'}`}>
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{userName}</p>
              <p className="text-sm text-gray-500">Cá nhân</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate('/settings')}
                className={`p-2 rounded transition-colors ${theme === 'light' ? 'hover:bg-gray-200' : 'hover:bg-gray-700'}`}
              >
                <Settings className="w-5 h-5" />
              </button>
              <button
                onClick={toggleTheme}
                className={`p-2 rounded transition-colors ${theme === 'light' ? 'hover:bg-gray-200' : 'hover:bg-gray-700'}`}
              >
                {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className={`p-4 border-b ${theme === 'light' ? 'border-gray-200' : 'border-gray-700'} flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className={`p-2 rounded transition-colors ${theme === 'light' ? 'hover:bg-gray-200' : 'hover:bg-gray-700'}`}
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold">Hein AI</h1>
          </div>
          
          {/* Control buttons for regenerate and stop */}
          <div className="flex items-center gap-2">
            {isLoading ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                <StopCircle className="w-4 h-4" />
                <span className="text-sm">Dừng</span>
              </button>
            ) : messages.length > 1 && (
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="text-sm">Tạo lại</span>
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={messagesContainerRef}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-3xl p-4 rounded-2xl relative group shadow-sm ${msg.role === 'user' ? (theme === 'light' ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white') : (theme === 'light' ? 'bg-white text-gray-900 border border-gray-200' : 'bg-gray-800 text-white border border-gray-700')}`}>
                <div className="flex items-start gap-3">
                  {msg.role === 'ai' ? (
                    <Bot className="w-5 h-5 mt-1 flex-shrink-0 text-blue-500" />
                  ) : (
                    <User className="w-5 h-5 mt-1 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm mb-1">{msg.role === 'user' ? userName : 'Hein AI'}</p>
                    <div className="whitespace-pre-wrap break-words prose prose-sm max-w-none dark:prose-invert">
                      {typeof formatMessageContent(msg.content, msg.role) === 'string' 
                        ? <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(formatMessageContent(msg.content, msg.role), { 
                            ADD_TAGS: ['img', 'button', 'div', 'pre', 'code'], 
                            ADD_ATTR: ['src', 'alt', 'loading', 'class', 'data-code'] 
                          }) }} />
                        : formatMessageContent(msg.content, msg.role)
                      }
                    </div>
                    <p className="text-xs opacity-70 mt-2">{formatTime(msg.timestamp)}</p>
                  </div>
                </div>
                {msg.id && !msg.id.startsWith('welcome') && !msg.id.startsWith('new-chat') && !msg.id.startsWith('deleted') && (
                  <button
                    onClick={() => handleDeleteMessage(msg.id)}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-red-500/20"
                    title="Xóa tin nhắn"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className={`p-4 rounded-2xl ${theme === 'light' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'bg-gray-800 text-white shadow-sm border border-gray-700'}`}>
                <div className="flex items-center gap-3">
                  <Bot className="w-5 h-5 text-blue-500" />
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Đang xử lý...</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className={`p-6 border-t ${theme === 'light' ? 'border-gray-200 bg-white' : 'border-gray-700 bg-gray-800'}`}>
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Nhập tin nhắn của bạn..."
                className={`w-full p-4 pr-32 rounded-xl border-2 resize-none focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200 ${theme === 'light' ? 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-500' : 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'} shadow-sm focus:ring-blue-500 min-h-[3rem] max-h-48`}
                disabled={isLoading}
                rows={1}
                style={{ 
                  height: 'auto',
                  minHeight: '3rem'
                }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 192) + 'px';
                }}
              />
              
              {/* Formatting Buttons */}
              {!isLoading && input.trim() && (
                <div className="absolute right-24 top-3 flex gap-1">
                  <button
                    onClick={insertBold}
                    className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'} transition-colors`}
                    title="Bold (Ctrl+B)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={insertItalic}
                    className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'} transition-colors`}
                    title="Italic (Ctrl+I)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={insertCode}
                    className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'} transition-colors`}
                    title="Code (Ctrl+`)"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Action Buttons */}
              <div className="absolute right-3 top-3 flex gap-2" ref={dropdownRef}>
                {/* Action Dropdown */}
                {!isLoading && input.trim() && (
                  <div className="relative">
                    <button
                      onClick={() => setShowActionDropdown(!showActionDropdown)}
                      className={`p-2 rounded-lg transition-colors ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'}`}
                      title="Thêm tùy chọn"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    {showActionDropdown && (
                      <div className={`absolute right-0 bottom-full mb-2 w-48 ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-gray-700 border-gray-600'} rounded-lg shadow-lg border py-2 z-10`}>
                        <button
                          onClick={handleWebSearch}
                          disabled={isLoading || !input.trim()}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left ${theme === 'light' ? 'hover:bg-gray-100 text-gray-900' : 'hover:bg-gray-600 text-white'} ${isLoading || !input.trim() ? 'opacity-50 cursor-not-allowed' : ''} transition-colors`}
                        >
                          <Globe className="w-4 h-4" />
                          Tìm kiếm web
                        </button>
                        <button
                          onClick={handleGenerateImage}
                          disabled={isLoading || !input.trim()}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left ${theme === 'light' ? 'hover:bg-gray-100 text-gray-900' : 'hover:bg-gray-600 text-white'} ${isLoading || !input.trim() ? 'opacity-50 cursor-not-allowed' : ''} transition-colors`}
                        >
                          <Image className="w-4 h-4" />
                          Tạo ảnh
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Send Button */}
                <button
                  onClick={handleSendMessage}
                  disabled={isLoading || !input.trim()}
                  className={`p-2 rounded-lg transition-all duration-200 ${theme === 'light' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-blue-600 hover:bg-blue-700'} text-white shadow-md ${isLoading || !input.trim() ? 'opacity-50 cursor-not-allowed scale-95' : 'hover:scale-105'}`}
                  title="Gửi (Enter)"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Shortcuts hint */}
            <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
              <span>Enter để gửi, Shift+Enter để xuống dòng</span>
              <span>Ctrl+B/I/` để định dạng</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}