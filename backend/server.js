import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import xss from 'xss';

const { default: cheerio } = await import('cheerio');

dotenv.config();

// Kiểm tra biến môi trường
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENROUTER_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Lỗi: ${envVar} phải được thiết lập trong file .env`);
    process.exit(1);
  }
}

const app = express();

// Security middleware - Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://openrouter.ai", "https://image.pollinations.ai", "https://duckduckgo.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for API server
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100, // Giới hạn mỗi IP 100 requests per windowMs
  message: {
    error: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau 15 phút'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

// Rate limiting riêng cho các endpoint nhạy cảm
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 5, // Giới hạn 5 lần đăng nhập/đăng ký per IP per 15 phút
  message: {
    error: 'Quá nhiều lần thử đăng nhập/đăng ký, vui lòng thử lại sau 15 phút'
  },
  skipSuccessfulRequests: true, // Không đếm requests thành công
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 phút
  max: 20, // Giới hạn 20 chat messages per minute
  message: {
    error: 'Quá nhiều tin nhắn, vui lòng thử lại sau 1 phút'
  }
});

// Apply rate limiting
app.use(limiter);

// CORS configuration nâng cao
const allowedOrigins = [
  'https://hein1.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173', // Vite default port
  'http://localhost:5174'  // Vite alternative port
];

// Development mode - allow more origins
if (process.env.NODE_ENV === 'development') {
  allowedOrigins.push('http://127.0.0.1:3000', 'http://127.0.0.1:5173');
}

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`🚫 CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Preflight requests
app.options('*', cors());

// Body parsing với size limits
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // XSS protection cho JSON payload
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openRouterKey = process.env.OPENROUTER_API_KEY;
const jwtSecret = process.env.JWT_SECRET || 'supersecret-change-in-production';

// Utility function để sanitize input
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return xss(input.trim(), {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script']
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Hein AI Backend',
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint với API documentation
app.get('/', (req, res) => {
  res.json({ 
    message: 'Hein AI Backend API', 
    version: '1.0.0',
    documentation: {
      endpoints: [
        { method: 'GET', path: '/health', description: 'Health check' },
        { method: 'POST', path: '/api/register', description: 'User registration' },
        { method: 'POST', path: '/api/login', description: 'User login' },
        { method: 'GET', path: '/api/chat/history', description: 'Get chat history' },
        { method: 'POST', path: '/api/chat', description: 'Send chat message' },
        { method: 'POST', path: '/api/generate-image', description: 'Generate image' },
        { method: 'DELETE', path: '/api/chat/:chatId', description: 'Delete chat' },
        { method: 'DELETE', path: '/api/message/:messageId', description: 'Delete message' }
      ],
      rateLimit: {
        general: '100 requests per 15 minutes',
        auth: '5 requests per 15 minutes', 
        chat: '20 requests per minute'
      }
    },
    timestamp: new Date().toISOString()
  });
});

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const origin = req.get('origin') || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  
  console.log(`📝 ${timestamp} - ${req.method} ${req.path} from ${origin}`);
  
  // Log body size for large requests
  if (req.headers['content-length']) {
    const sizeKB = Math.round(parseInt(req.headers['content-length']) / 1024);
    if (sizeKB > 100) {
      console.log(`📦 Large payload: ${sizeKB}KB`);
    }
  }
  
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  
  // CORS error
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: 'CORS policy violation',
      message: 'Origin not allowed'
    });
  }
  
  // Rate limit error
  if (err.status === 429) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: err.message
    });
  }
  
  res.status(500).json({ 
    error: 'Lỗi server nội bộ', 
    details: process.env.NODE_ENV === 'development' ? err.message : 'Lỗi không xác định',
    timestamp: new Date().toISOString()
  });
});

// Middleware xác thực JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Token không hợp lệ',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('🔐 JWT verification failed:', err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({ 
        error: 'Token đã hết hạn',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    return res.status(403).json({ 
      error: 'Token không hợp lệ',
      code: 'INVALID_TOKEN'
    });
  }
}

// Hàm retry API với exponential backoff
async function retryAPICall(apiCall, maxRetries = 3, initialDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await apiCall();
      
      if (response && response.status !== 429) {
        return response;
      }
      
      if (attempt === maxRetries) {
        throw new Error('Đã đạt số lần thử tối đa do giới hạn tỷ lệ');
      }
      
      const retryAfter = response?.headers?.get('retry-after') || response?.headers?.get('x-ratelimit-reset');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : initialDelay * Math.pow(2, attempt - 1);
      
      console.log(`⏳ Rate limited, retrying after ${delay}ms (attempt ${attempt}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('⏹️ API request cancelled');
        return null;
      }
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`⚠️ Attempt ${attempt} failed:`, err.message);
      await new Promise(resolve => setTimeout(resolve, initialDelay * attempt));
    }
  }
}

// Dịch sang tiếng Việt cho kết quả tìm kiếm
async function translateToVietnamese(text) {
  try {
    if (!text || typeof text !== 'string' || text.length > 1000) {
      return text;
    }
    
    const response = await retryAPICall(() => 
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein-ai.com',
          'X-Title': 'Hein AI',
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: [
            {
              role: 'system',
              content: 'Bạn là trợ lý dịch thuật. Dịch văn bản sang tiếng Việt một cách chính xác, tự nhiên. Chỉ trả về bản dịch.',
            },
            {
              role: 'user',
              content: `Dịch sang tiếng Việt: ${text}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 300,
          stream: false,
        }),
      })
    );

    if (!response || !response.ok) {
      return text;
    }

    const data = await response.json();
    const translated = data.choices[0]?.message?.content?.trim() || text;
    return translated;
  } catch (err) {
    console.warn('⚠️ Translation failed:', err.message);
    return text;
  }
};

// Dịch sang tiếng Anh (chỉ cho tạo ảnh)
async function translateToEnglish(text) {
  try {
    const response = await retryAPICall(() => 
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein-ai.com',
          'X-Title': 'Hein AI',
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: [
            {
              role: 'system',
              content: 'You are a creative translation assistant. Translate to English accurately with descriptive details for image generation. Return only the translation.',
            },
            {
              role: 'user',
              content: `Translate to English for image generation: ${text}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 100,
          stream: false,
        }),
      })
    );

    if (!response || !response.ok) {
      return text;
    }

    const data = await response.json();
    const translated = data.choices[0]?.message?.content?.trim() || text;
    return translated;
  } catch (err) {
    console.warn('⚠️ English translation failed:', err.message);
    return text;
  }
};

// Hàm tìm kiếm web với giới hạn 5 kết quả
async function webSearch(query) {
  try {
    const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Search failed with status ${response.status}`);
    }

    const html = await response.text();
    if (!html) {
      throw new Error('Empty search response');
    }
    
    const $ = cheerio.load(html);
    const results = [];

    // Get max 5 results
    $('.result').slice(0, 5).each((i, el) => {
      const title = $(el).find('.result__title').text().trim();
      let link = $(el).find('.result__url').attr('href') || $(el).find('.result__a').attr('href');
      const snippet = $(el).find('.result__snippet').text().trim();

      if (title && link && snippet && snippet.length > 10) {
        link = link.startsWith('http') ? link : `https://duckduckgo.com${link}`;
        
        // Filter out ads and irrelevant pages
        const excludePatterns = ['ad.', 'sponsor', 'doubleclick', 'shop', 'amazon.com/dp'];
        const isExcluded = excludePatterns.some(pattern => link.includes(pattern));
        
        if (!isExcluded) {
          results.push({
            title: sanitizeInput(title),
            link: link,
            snippet: sanitizeInput(snippet)
          });
        }
      }
    });

    // Translate results to Vietnamese
    const translatedResults = [];
    for (const result of results) {
      const translatedTitle = await translateToVietnamese(result.title);
      const translatedSnippet = await translateToVietnamese(result.snippet);
      translatedResults.push({
        title: translatedTitle,
        link: result.link,
        snippet: translatedSnippet
      });
    }

    return translatedResults;
  } catch (err) {
    console.error('❌ Web search error:', err.message);
    return [];
  }
};

// Endpoint đăng ký với rate limiting và validation
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    let { name, email, password } = req.body;
    
    // Sanitize inputs
    name = sanitizeInput(name);
    email = sanitizeInput(email);
    
    if (!name || !email || !password) {
      return res.status(400).json({ 
        error: 'Thiếu thông tin bắt buộc',
        code: 'MISSING_FIELDS'
      });
    }

    // Validation
    if (name.length < 2 || name.length > 50) {
      return res.status(400).json({ 
        error: 'Tên phải từ 2-50 ký tự',
        code: 'INVALID_NAME'
      });
    }

    if (password.length < 6 || password.length > 100) {
      return res.status(400).json({ 
        error: 'Mật khẩu phải từ 6-100 ký tự',
        code: 'INVALID_PASSWORD'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 100) {
      return res.status(400).json({ 
        error: 'Email không hợp lệ',
        code: 'INVALID_EMAIL'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12); // Increased rounds for security
    
    const userId = uuidv4();
    const userData = {
      id: userId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword
    };

    const { data: newUser, error } = await supabase
      .from('users')
      .insert(userData)
      .select('id, name, email')
      .single();

    if (error) {
      console.error('❌ Supabase error:', error.code, error.message);
      
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        return res.status(409).json({ 
          error: 'Email đã được đăng ký',
          code: 'EMAIL_EXISTS'
        });
      }
      
      return res.status(500).json({ 
        error: 'Lỗi database', 
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    console.log('✅ User registered successfully:', newUser.email);

    res.status(201).json({ 
      message: 'Đăng ký thành công!',
      user: { 
        id: newUser.id,
        name: newUser.name, 
        email: newUser.email 
      }
    });

  } catch (err) {
    console.error('❌ Registration error:', err);
    res.status(500).json({ 
      error: 'Lỗi server', 
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Endpoint đăng nhập với rate limiting
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    console.log('🔐 Login request from:', req.get('origin'));
    
    let { email, password } = req.body;
    
    // Sanitize inputs
    email = sanitizeInput(email);
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Thiếu email hoặc mật khẩu',
        code: 'MISSING_CREDENTIALS'
      });
    }

    if (email.length > 100 || password.length > 100) {
      return res.status(400).json({ 
        error: 'Thông tin đăng nhập không hợp lệ',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ 
        error: 'Email hoặc mật khẩu không đúng',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log('❌ Invalid password for:', email);
      return res.status(401).json({ 
        error: 'Email hoặc mật khẩu không đúng',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        iat: Math.floor(Date.now() / 1000)
      }, 
      jwtSecret, 
      { expiresIn: '7d' }
    );
    
    console.log('✅ Login successful for:', email);
    
    res.json({ 
      token, 
      user: { 
        id: user.id,
        name: user.name, 
        email: user.email 
      }
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ 
      error: 'Lỗi server', 
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Endpoint lấy lịch sử chat
app.get('/api/chat/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('📚 Fetching chat history for user:', userId);

    const { data: chats, error: chatsError } = await supabase
      .from('chats')
      .select('id, title, last_message, timestamp')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(50); // Limit to 50 recent chats

    if (chatsError) {
      console.error('❌ Supabase chats error:', chatsError);
      return res.status(500).json({ 
        error: 'Lỗi truy vấn chats', 
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? chatsError.message : undefined
      });
    }

    if (!chats?.length) {
      return res.json({ history: [] });
    }

    const { data: allMessages, error: msgsError } = await supabase
      .from('messages')
      .select('id, chat_id, role, content, timestamp')
      .in('chat_id', chats.map(c => c.id))
      .order('timestamp', { ascending: true });

    if (msgsError) {
      console.error('❌ Supabase messages error:', msgsError);
      return res.status(500).json({ 
        error: 'Lỗi truy vấn messages', 
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? msgsError.message : undefined
      });
    }

    const history = chats.map(chat => ({
      ...chat,
      messages: (allMessages?.filter(m => m.chat_id === chat.id) || []).map(msg => ({
        ...msg,
        content: sanitizeInput(msg.content) // Sanitize message content
      }))
    }));

    console.log(`✅ Returning ${history.length} chats for user ${userId}`);
    res.json({ history });
  } catch (err) {
    console.error('❌ Chat history error:', err);
    res.status(500).json({ 
      error: 'Lỗi server', 
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Endpoint chat với hỗ trợ tìm kiếm web và rate limiting
app.post('/api/chat', authenticateToken, chatLimiter, async (req, res) => {
  try {
    let { messages, chatId } = req.body;
    
    if (!messages?.length) {
      return res.status(400).json({ 
        error: 'Thiếu messages',
        code: 'MISSING_MESSAGES'
      });
    }

    // Validate and sanitize messages
    if (messages.length > 50) {
      return res.status(400).json({ 
        error: 'Quá nhiều tin nhắn trong request',
        code: 'TOO_MANY_MESSAGES'
      });
    }

    messages = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: sanitizeInput(msg.content?.slice(0, 4000)) // Limit message length
    })).filter(msg => msg.content && msg.content.length > 0);

    if (!messages.length) {
      return res.status(400).json({ 
        error: 'Không có tin nhắn hợp lệ',
        code: 'NO_VALID_MESSAGES'
      });
    }

    const userId = req.user.id;
    let currentChatId = chatId;

    console.log(`💬 Processing chat request for user ${userId}, chatId: ${currentChatId}`);

    if (!currentChatId) {
      const newChatId = uuidv4();
      const chatTitle = messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? '...' : '');
      
      const { error: insertError } = await supabase
        .from('chats')
        .insert([{
          id: newChatId,
          user_id: userId,
          title: sanitizeInput(chatTitle),
          last_message: messages[0].content.slice(0, 100),
          timestamp: new Date().toISOString()
        }]);

      if (insertError) {
        console.error('❌ Supabase chat insert error:', insertError);
        return res.status(500).json({ 
          error: 'Lỗi tạo chat mới', 
          code: 'DATABASE_ERROR',
          details: process.env.NODE_ENV === 'development' ? insertError.message : undefined
        });
      }
      currentChatId = newChatId;
      console.log('✅ Created new chat:', newChatId);
    } else {
      // Validate chat ownership
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', currentChatId)
        .eq('user_id', userId)
        .single();

      if (chatError || !chat) {
        console.error('❌ Chat validation error:', chatError);
        return res.status(404).json({ 
          error: 'Không tìm thấy chat',
          code: 'CHAT_NOT_FOUND'
        });
      }
    }

    // Prepare messages for AI
    const recentMessages = messages.slice(-15); // Keep last 15 messages for context
    let formattedMessages = [
      {
        role: 'system',
        content: 'Bạn là Hein, một trợ lý AI thông minh và hữu ích từ Hein AI. Hãy trả lời tự nhiên bằng ngôn ngữ của người dùng. Sử dụng emoji khi phù hợp 😊. Sử dụng công cụ web_search khi cần thông tin thời gian thực hoặc khi người dùng yêu cầu tìm kiếm.'
      },
      ...recentMessages
    ];

    const tools = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Tìm kiếm thông tin trên internet để có dữ liệu mới nhất và chính xác.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Từ khóa tìm kiếm'
              }
            },
            required: ['query']
          }
        }
      }
    ];

    // First AI call
    let openRouterResponse = await retryAPICall(() =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein-ai.com',
          'X-Title': 'Hein AI',
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: formattedMessages,
          tools: tools,
          temperature: 0.7,
          max_tokens: 1000,
          stream: false,
        }),
      })
    );

    if (!openRouterResponse) {
      return res.status(499).json({ 
        error: 'Yêu cầu bị hủy',
        code: 'REQUEST_CANCELLED'
      });
    }

    if (!openRouterResponse.ok) {
      const errorData = await openRouterResponse.json().catch(() => ({}));
      console.error('❌ OpenRouter API error:', errorData);
      return res.status(500).json({ 
        error: 'Lỗi API OpenRouter', 
        code: 'OPENROUTER_ERROR',
        details: errorData.error?.message || 'Lỗi không xác định' 
      });
    }

    let data = await openRouterResponse.json();
    let aiMessage = data.choices[0]?.message?.content || '';
    const messageId = uuidv4();

    // Handle tool calls (web search)
    if (data.choices[0]?.finish_reason === 'tool_calls' && data.choices[0]?.message?.tool_calls) {
      const toolCalls = data.choices[0].message.tool_calls;
      console.log(`🔍 Processing ${toolCalls.length} tool calls`);

      formattedMessages.push(data.choices[0].message);

      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'web_search') {
          let args;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (parseErr) {
            console.error('❌ Tool arguments parse error:', parseErr.message);
            continue;
          }

          console.log('🔍 Web search query:', args.query);
          const searchResults = await webSearch(args.query);
          console.log(`📊 Found ${searchResults.length} search results`);

          formattedMessages.push({
            role: 'tool',
            content: JSON.stringify({ 
              results: searchResults.slice(0, 3), // Limit to 3 results to save tokens
              query: args.query,
              timestamp: new Date().toISOString()
            }),
            tool_call_id: toolCall.id,
            name: 'web_search'
          });
        }
      }

      // Second AI call with search results
      const toolResponse = await retryAPICall(() =>
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://hein-ai.com',
            'X-Title': 'Hein AI',
          },
          body: JSON.stringify({
            model: 'x-ai/grok-4-fast:free',
            messages: formattedMessages,
            temperature: 0.7,
            max_tokens: 1200,
            stream: false,
          }),
        })
      );

      if (!toolResponse) {
        return res.status(499).json({ 
          error: 'Yêu cầu bị hủy',
          code: 'REQUEST_CANCELLED'
        });
      }

      if (!toolResponse.ok) {
        const errorData = await toolResponse.json().catch(() => ({}));
        console.error('❌ OpenRouter tool response error:', errorData);
        return res.status(500).json({ 
          error: 'Lỗi xử lý tìm kiếm', 
          code: 'SEARCH_ERROR',
          details: errorData.error?.message || 'Lỗi không xác định' 
        });
      }

      const toolData = await toolResponse.json();
      aiMessage = toolData.choices[0]?.message?.content || aiMessage;
    }

    // Sanitize AI response
    aiMessage = sanitizeInput(aiMessage);
    
    if (!aiMessage) {
      return res.status(500).json({ 
        error: 'Phản hồi AI trống',
        code: 'EMPTY_RESPONSE'
      });
    }

    // Save messages to database
    const messagesToSave = [];
    const lastUserMsg = messages[messages.length - 1];
    
    if (lastUserMsg.role === 'user') {
      messagesToSave.push({ 
        id: uuidv4(),
        chat_id: currentChatId, 
        role: 'user', 
        content: lastUserMsg.content, 
        timestamp: new Date().toISOString() 
      });
    }

    messagesToSave.push({ 
      id: messageId,
      chat_id: currentChatId, 
      role: 'ai', 
      content: aiMessage, 
      timestamp: new Date().toISOString() 
    });

    if (messagesToSave.length > 0) {
      const { error: saveError } = await supabase
        .from('messages')
        .insert(messagesToSave);
        
      if (saveError) {
        console.error('❌ Error saving messages:', saveError);
        // Don't return error, just log it
      }
    }

    // Update chat metadata
    const { error: updateError } = await supabase
      .from('chats')
      .update({
        last_message: aiMessage.slice(0, 100) + (aiMessage.length > 100 ? '...' : ''),
        timestamp: new Date().toISOString()
      })
      .eq('id', currentChatId);

    if (updateError) {
      console.error('❌ Error updating chat:', updateError);
      // Don't return error, just log it
    }

    console.log('✅ Chat response sent successfully');
    res.json({
      message: aiMessage,
      messageId,
      timestamp: new Date().toISOString(),
      model: 'grok-4-fast-free',
      chatId: currentChatId
    });

  } catch (error) {
    console.error('❌ Chat API error:', error);
    res.status(500).json({ 
      error: 'Lỗi xử lý tin nhắn', 
      code: 'PROCESSING_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Endpoint tạo ảnh với Pollinations.ai
app.post('/api/generate-image', authenticateToken, chatLimiter, async (req, res) => {
  try {
    let { prompt, chatId } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ 
        error: 'Prompt là bắt buộc',
        code: 'MISSING_PROMPT'
      });
    }

    // Sanitize and validate prompt
    prompt = sanitizeInput(prompt);
    if (prompt.length > 500) {
      return res.status(400).json({ 
        error: 'Prompt quá dài, tối đa 500 ký tự',
        code: 'PROMPT_TOO_LONG'
      });
    }
    if (prompt.length < 3) {
      return res.status(400).json({ 
        error: 'Prompt quá ngắn, tối thiểu 3 ký tự',
        code: 'PROMPT_TOO_SHORT'
      });
    }

    const userId = req.user.id;
    let currentChatId = chatId;

    console.log(`🎨 Generating image for user ${userId}, prompt: "${prompt}"`);

    if (!currentChatId) {
      const newChatId = uuidv4();
      const { error: insertError } = await supabase
        .from('chats')
        .insert([{
          id: newChatId,
          user_id: userId,
          title: `Tạo ảnh: ${prompt.slice(0, 30)}${prompt.length > 30 ? '...' : ''}`,
          last_message: prompt,
          timestamp: new Date().toISOString()
        }]);

      if (insertError) {
        console.error('❌ Supabase chat insert error:', insertError);
        return res.status(500).json({ 
          error: 'Lỗi tạo chat mới', 
          code: 'DATABASE_ERROR',
          details: process.env.NODE_ENV === 'development' ? insertError.message : undefined
        });
      }
      currentChatId = newChatId;
    } else {
      // Validate chat ownership
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', currentChatId)
        .eq('user_id', userId)
        .single();

      if (chatError || !chat) {
        console.error('❌ Chat validation error:', chatError);
        return res.status(404).json({ 
          error: 'Không tìm thấy chat',
          code: 'CHAT_NOT_FOUND'
        });
      }
    }

    // Translate prompt to English for better image generation
    const translatedPrompt = await translateToEnglish(prompt);
    console.log('🔤 Translated prompt:', translatedPrompt);

    // Generate image with Pollinations.ai
    const encodedPrompt = encodeURIComponent(translatedPrompt);
    const timestamp = Date.now();
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&safe=true&seed=${timestamp}`;

    // Test if image URL is accessible
    const pollinationsResponse = await retryAPICall(() =>
      fetch(imageUrl, {
        method: 'HEAD', // Use HEAD to check without downloading
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
    );

    if (!pollinationsResponse) {
      return res.status(499).json({ 
        error: 'Yêu cầu bị hủy',
        code: 'REQUEST_CANCELLED'
      });
    }

    if (!pollinationsResponse.ok) {
      console.error('❌ Pollinations.ai error:', {
        status: pollinationsResponse.status,
        statusText: pollinationsResponse.statusText
      });
      return res.status(500).json({
        error: 'Lỗi tạo ảnh từ Pollinations.ai',
        code: 'IMAGE_GENERATION_ERROR',
        details: `Status: ${pollinationsResponse.status}`
      });
    }

    const messageId = uuidv4();
    const imageMessage = `🎨 **Ảnh đã tạo:** ${prompt}\n\n![Generated Image](${imageUrl})`;

    // Save messages to database
    const messagesToSave = [
      { 
        id: uuidv4(),
        chat_id: currentChatId, 
        role: 'user', 
        content: prompt, 
        timestamp: new Date().toISOString() 
      },
      { 
        id: messageId,
        chat_id: currentChatId, 
        role: 'ai', 
        content: imageMessage, 
        timestamp: new Date().toISOString() 
      }
    ];

    const { error: saveError } = await supabase
      .from('messages')
      .insert(messagesToSave);

    if (saveError) {
      console.error('❌ Error saving image messages:', saveError);
      return res.status(500).json({ 
        error: 'Lỗi lưu tin nhắn',
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? saveError.message : undefined
      });
    }

    // Update chat metadata
    const { error: updateError } = await supabase
      .from('chats')
      .update({
        last_message: 'Hình ảnh đã tạo',
        timestamp: new Date().toISOString()
      })
      .eq('id', currentChatId);

    if (updateError) {
      console.error('❌ Error updating chat:', updateError);
      // Don't return error, just log it
    }

    console.log('✅ Image generated successfully');
    res.json({
      message: imageMessage,
      imageUrl: imageUrl,
      messageId,
      timestamp: new Date().toISOString(),
      chatId: currentChatId
    });
  } catch (error) {
    console.error('❌ Image generation error:', error);
    res.status(500).json({ 
      error: 'Lỗi tạo ảnh', 
      code: 'IMAGE_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Endpoint xóa chat
app.delete('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', userId)
      .single();

    if (chatError || !chat) {
      console.error('❌ Chat validation error:', chatError);
      return res.status(404).json({ 
        error: 'Không tìm thấy chat',
        code: 'CHAT_NOT_FOUND'
      });
    }

    // Delete messages first (cascade might not be set up)
    const { error: deleteMessagesError } = await supabase
      .from('messages')
      .delete()
      .eq('chat_id', chatId);

    if (deleteMessagesError) {
      console.error('❌ Error deleting messages:', deleteMessagesError);
      return res.status(500).json({ 
        error: 'Lỗi xóa tin nhắn',
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? deleteMessagesError.message : undefined
      });
    }

    // Delete chat
    const { error: deleteError } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId);

    if (deleteError) {
      console.error('❌ Error deleting chat:', deleteError);
      return res.status(500).json({ 
        error: 'Lỗi xóa chat',
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? deleteError.message : undefined
      });
    }

    console.log('✅ Chat deleted successfully');
    res.json({ 
      message: 'Chat đã được xóa thành công',
      chatId: chatId
    });
  } catch (err) {
    console.error('❌ Delete chat error:', err);
    res.status(500).json({ 
      error: 'Lỗi server', 
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Endpoint xóa tin nhắn
app.delete('/api/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('chat_id')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      console.error('❌ Message validation error:', messageError);
      return res.status(404).json({ 
        error: 'Không tìm thấy tin nhắn',
        code: 'MESSAGE_NOT_FOUND'
      });
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', message.chat_id)
      .eq('user_id', userId)
      .single();

    if (chatError || !chat) {
      console.error('❌ Chat ownership validation error:', chatError);
      return res.status(404).json({ 
        error: 'Không tìm thấy chat liên quan',
        code: 'CHAT_NOT_FOUND'
      });
    }

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (deleteError) {
      console.error('❌ Error deleting message:', deleteError);
      return res.status(500).json({ 
        error: 'Lỗi xóa tin nhắn',
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? deleteError.message : undefined
      });
    }

    console.log('✅ Message deleted successfully');
    res.json({ 
      message: 'Tin nhắn đã được xóa thành công',
      messageId: messageId
    });
  } catch (err) {
    console.error('❌ Delete message error:', err);
    res.status(500).json({ 
      error: 'Lỗi server',
      code: 'SERVER_ERROR', 
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Endpoint không tồn tại',
    code: 'ENDPOINT_NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'POST /api/register',
      'POST /api/login',
      'GET /api/chat/history',
      'POST /api/chat',
      'POST /api/generate-image',
      'DELETE /api/chat/:chatId',
      'DELETE /api/message/:messageId'
    ]
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled promise rejection handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process in production
  if (process.env.NODE_ENV === 'development') {
    process.exit(1);
  }
});

// Uncaught exception handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Khởi động server
const PORT = process.env.PORT || 3001;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

const server = app.listen(PORT, HOST, () => {
  console.log('🚀================================🚀');
  console.log('🌟 HEIN AI BACKEND SERVER STARTED 🌟');
  console.log('🚀================================🚀');
  console.log(`📍 Server: http://${HOST}:${PORT}`);
  console.log(`🌍 External: http://0.0.0.0:${PORT}`);
  console.log(`📱 Frontend: https://hein1.onrender.com`);
  console.log(`🔍 Health: http://${HOST}:${PORT}/health`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚡ Node.js: ${process.version}`);
  console.log(`📊 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  console.log('🚀================================🚀');
});

// Server timeout settings
server.timeout = 120000; // 2 minutes
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // 66 seconds
