// src/Chat.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Send, Bot, User, Loader2, Menu, Plus, Search, Settings, Moon, Sun, Trash2, Home, Bold, Italic, Code, 
  Globe, Image, ChevronDown, StopCircle
} from 'lucide-react';
import DOMPurify from 'dompurify';
import apiService from './services/api';

// Image Message Component
const ImageMessage = ({ src, alt }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  const handleError = () => {
    if (retryCount < maxRetries) {
      setTimeout(() => {
        setRetryCount(prev => prev + 1);
        setIsLoading(true); // Trigger reload
      }, 1000); // Wait 1 second before retrying
    } else {
      setIsLoading(false);
      setHasError(true);
    }
  };

  return (
    <div className="relative my-2">
      {isLoading && (
        <div className="flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-lg p-8">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      )}
      {!hasError ? (
        <img
          src={`${src}${retryCount > 0 ? `?retry=${retryCount}` : ''}`} // Add query param to force reload
          alt={alt || 'Generated Image'}
          className="max-w-full h-auto rounded-lg shadow-lg"
          onLoad={() => setIsLoading(false)}
          onError={handleError}
          style={{ display: isLoading ? 'none' : 'block' }}
        />
      ) : (
        <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-lg">
          <p className="font-medium">Không thể tải ảnh</p>
          <p className="text-sm mt-1">URL: {src}</p>
        </div>
      )}
    </div>
  );
};

// Message Content Component
const MessageContent = ({ content, role }) => {
  // Check if content contains image markdown
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const hasImage = imageRegex.test(content);

  if (hasImage) {
    const parts = [];
    let lastIndex = 0;
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      // Add text before image
      if (match.index > lastIndex) {
        const textBefore = content.substring(lastIndex, match.index);
        if (textBefore.trim()) {
          parts.push({ type: 'text', content: textBefore });
        }
      }

      // Add image
      parts.push({ type: 'image', alt: match[1], src: match[2] });
      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      const textAfter = content.substring(lastIndex);
      if (textAfter.trim()) {
        parts.push({ type: 'text', content: textAfter });
      }
    }

    return (
      <div>
        {parts.map((part, index) => {
          if (part.type === 'image') {
            return <ImageMessage key={index} src={part.src} alt={part.alt} />;
          }
          return (
            <div 
              key={index}
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: parseMarkdown(part.content) }}
            />
          );
        })}
      </div>
    );
  }

  // Regular text content
  return (
    <div 
      className="prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
    />
  );
};

// Enhanced markdown parser
function parseMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  
  try {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
        const langClass = lang ? ` language-${lang}` : '';
        return `<div class="relative my-2"><pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto shadow-sm"><code class="${langClass}">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre><button class="copy-code-btn absolute top-2 right-2 px-2 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors text-sm font-medium">Copy</button></div>`;
      })
      .replace(/`([^`]+)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm">$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>')
      .replace(/__(.*?)__/g, '<strong class="font-bold">$1</strong>')
      .replace(/\*([^\*]+)\*/g, '<em class="italic">$1</em>')
      .replace(/_([^_]+)_/g, '<em class="italic">$1</em>')
      .replace(/~~(.*?)~~/g, '<del class="line-through opacity-70">$1</del>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto rounded-lg shadow-lg" />')
      .replace(/\n/g, '<br>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline">$1</a>')
      .replace(/^(#{1,6})\s*(.*)$/gm, (match, level, content) => {
        const tag = `h${level.length}`;
        const size = 7 - level.length;
        return `<${tag} class="font-bold mt-4 mb-2 text-${size}xl">${content}</${tag}>`;
      })
      .replace(/^[-*]\s+(.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^\d+\.\s+(.*)$/gm, '<li class="ml-4 list-decimal">$1</li>');

    return DOMPurify.sanitize(html, { 
      ALLOWED_TAGS: ['strong', 'em', 'del', 'a', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'p', 'div', 'button', 'img'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'src', 'alt']
    });
  } catch (err) {
    console.error('Markdown parse error:', err);
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

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
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const dropdownRef = useRef(null);
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
        const codeElement = e.target.previousSibling?.querySelector('code');
        if (codeElement) {
          navigator.clipboard.writeText(codeElement.textContent)
            .then(() => {
              const originalText = e.target.textContent;
              e.target.textContent = 'Copied!';
              e.target.disabled = true;
              setTimeout(() => {
                e.target.textContent = originalText;
                e.target.disabled = false;
              }, 2000);
            })
            .catch(err => console.error('Copy error:', err));
        }
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
  }, [chatHistory]);

  // Format timestamp
  const formatTimestamp = useCallback((timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Hôm qua ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }, []);

  // Group chat history by date
  const groupedHistory = useMemo(() => {
    const groups = {};
    chatHistory.forEach(chat => {
      const date = new Date(chat.created_at || chat.timestamp).toDateString();
      if (!groups[date]) groups[date] = [];
      groups[date].push(chat);
    });
    return groups;
  }, [chatHistory]);

  // Insert formatting
  const insertFormatting = useCallback((formatType) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = input.substring(start, end);
    let newText, newCursorPos;

    switch (formatType) {
      case 'bold':
        newText = `**${selectedText || 'text'}**`;
        newCursorPos = start + 2 + (selectedText ? selectedText.length : 4);
        break;
      case 'italic':
        newText = `_${selectedText || 'text'}_`;
        newCursorPos = start + 1 + (selectedText ? selectedText.length : 4);
        break;
      case 'code':
        newText = `\`${selectedText || 'code'}\``;
        newCursorPos = start + 1 + (selectedText ? selectedText.length : 4);
        break;
      default:
        return;
    }

    setInput(input.substring(0, start) + newText + input.substring(end));
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [input]);

  // Handle keydown
  const handleKeyDown = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          insertFormatting('bold');
          break;
        case 'i':
          e.preventDefault();
          insertFormatting('italic');
          break;
        case '`':
          e.preventDefault();
          insertFormatting('code');
          break;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [isLoading, insertFormatting]);

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
    setShowActionDropdown(false);
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
    setShowActionDropdown(false);
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

    setShowActionDropdown(false);

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

      console.log('Image API Response:', data); // Log for debugging

      if (!data.imageUrl) {
        throw new Error('No image URL returned from API');
      }

      const aiMessage = {
        id: data.messageId || `ai-${Date.now()}`,
        role: 'ai',
        content: data.message || `![Generated Image](${data.imageUrl || 'https://via.placeholder.com/1024?text=Image+Failed+to+Load'})`,
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
  }, [currentChatId]);

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
  }, []);

  // Toggle theme
  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  }, [theme]);

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
    e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
  }, []);

  return (
    <div className={`min-h-screen flex ${theme === 'light' ? 'bg-gray-50' : 'bg-gray-900'} text-gray-900 dark:text-white transition-colors duration-300`}>
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-30 w-64 transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${theme === 'light' ? 'bg-white border-r border-gray-200' : 'bg-gray-800 border-r border-gray-700'}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold">Lịch sử chat</h2>
            <button onClick={newChat} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm kiếm chat..."
                className={`w-full pl-10 pr-4 py-2 rounded-lg ${theme === 'light' ? 'bg-gray-100 border-gray-200 text-gray-900 placeholder-gray-500' : 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'} border focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors`}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {Object.entries(groupedHistory).map(([date, chats]) => (
              <div key={date}>
                <h3 className="text-sm font-semibold mb-2 text-gray-500 dark:text-gray-400">
                  {new Date(date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </h3>
                {chats.filter(chat => (chat.title || '').toLowerCase().includes(searchTerm.toLowerCase())).map(chat => (
                  <div 
                    key={chat.id}
                    className={`p-3 rounded-lg cursor-pointer relative group ${currentChatId === chat.id ? 'bg-blue-100 dark:bg-blue-900/30' : ''} ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'} transition-colors`}
                    onClick={() => loadChat(chat.id)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{chat.title || 'Cuộc trò chuyện mới'}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{chat.last_message || 'Không có tin nhắn'}</p>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteChat(chat.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
            <button 
              onClick={() => navigate('/home')}
              className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${theme === 'light' ? 'hover:bg-gray-100 text-gray-900' : 'hover:bg-gray-600 text-white'}`}
            >
              <Home className="w-5 h-5" />
              Trang chủ
            </button>
            <button 
              onClick={() => navigate('/settings')}
              className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${theme === 'light' ? 'hover:bg-gray-100 text-gray-900' : 'hover:bg-gray-600 text-white'}`}
            >
              <Settings className="w-5 h-5" />
              Cài đặt
            </button>
            <button 
              onClick={toggleTheme}
              className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${theme === 'light' ? 'hover:bg-gray-100 text-gray-900' : 'hover:bg-gray-600 text-white'}`}
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              {theme === 'light' ? 'Chế độ tối' : 'Chế độ sáng'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <nav className="fixed top-0 left-0 right-0 z-20 bg-gradient-to-r from-sky-500/70 to-indigo-600/70 backdrop-blur-md border-b border-white/10 shadow-xl px-4 py-3 md:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors md:hidden"
              >
                <Menu className="w-5 h-5 text-white" />
              </button>
              <h1 className="text-xl font-bold text-white">Chat Với AI</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-white/80 hidden sm:block">{userName}</span>
              <button 
                onClick={() => {
                  localStorage.clear();
                  navigate('/login');
                }}
                className="px-4 py-2 rounded-lg bg-red-500/70 hover:bg-red-600/70 text-white font-semibold transition-colors"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </nav>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 pt-20 pb-32">
          {error && (
            <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-4 text-red-500 hover:text-red-700">
                ✕
              </button>
            </div>
          )}
          {messages.map((msg) => (
            <div 
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[70%] p-4 rounded-2xl relative group ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'} shadow-sm`}>
                <div className="flex items-center gap-3 mb-2">
                  {msg.role === 'user' ? (
                    <User className="w-5 h-5" />
                  ) : (
                    <Bot className="w-5 h-5 text-blue-500" />
                  )}
                  <span className="font-medium">{msg.role === 'user' ? userName : 'Hein AI'}</span>
                </div>
                <MessageContent content={msg.content} role={msg.role} />
                <div className="flex justify-between items-center mt-2 text-xs opacity-70">
                  <span>{formatTimestamp(msg.timestamp)}</span>
                  {msg.role === 'user' && msg.id !== 'welcome' && (
                    <button 
                      onClick={() => deleteMessage(msg.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="max-w-[70%] p-4 rounded-2xl bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm">
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
        <div className={`fixed bottom-0 left-0 right-0 p-6 border-t ${theme === 'light' ? 'border-gray-200 bg-white' : 'border-gray-700 bg-gray-800'} z-10 md:static md:border-0 md:p-6`}>
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Nhập tin nhắn của bạn..."
                className={`w-full p-4 pr-32 rounded-xl border-2 resize-none focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200 ${theme === 'light' ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-500' : 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'} shadow-sm focus:ring-blue-500 min-h-[3rem] max-h-48`}
                disabled={isLoading}
                rows={1}
              />
              {!isLoading && input.trim() && (
                <div className="absolute right-24 top-3 flex gap-1">
                  <button
                    onClick={() => insertFormatting('bold')}
                    className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'} transition-colors`}
                    title="Bold (Ctrl+B)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => insertFormatting('italic')}
                    className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'} transition-colors`}
                    title="Italic (Ctrl+I)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => insertFormatting('code')}
                    className={`p-1.5 rounded-lg ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'} transition-colors`}
                    title="Code (Ctrl+`)"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="absolute right-3 top-3 flex gap-2" ref={dropdownRef}>
                {isLoading && (
                  <button
                    onClick={stopGeneration}
                    className="p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-all duration-200"
                    title="Dừng"
                  >
                    <StopCircle className="w-5 h-5" />
                  </button>
                )}
                {!isLoading && input.trim() && (
                  <div className="relative">
                    <button
                      onClick={() => setShowActionDropdown(!showActionDropdown)}
                      className={`p-2 rounded-lg ${theme === 'light' ? 'hover:bg-gray-200 text-gray-700' : 'hover:bg-gray-600 text-gray-300'} transition-colors`}
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
            <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
              <span>Enter để gửi, Shift+Enter để xuống dòng</span>
              <span className="text-right">Ctrl+B/I/` để định dạng | {input.length}/500</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
