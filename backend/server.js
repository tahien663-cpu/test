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
import { validate } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'JWT_SECRET'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openRouterKey = process.env.OPENROUTER_API_KEY;
const jwtSecret = process.env.JWT_SECRET;

// Serve static files from the Vite build output (dist folder)
app.use(express.static(path.join(__dirname, 'test', 'frontend', 'dist'), {
  maxAge: '1d'
}));

// Enable trust proxy for Render
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://openrouter.ai", "https://image.pollinations.ai", "https://api.duckduckgo.com", "https://en.wikipedia.org"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    }
  }
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login/register attempts, please try again after 15 minutes' },
  skipSuccessfulRequests: true
});

const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many image generation requests, please try again after 1 minute' },
  standardHeaders: true,
  legacyHeaders: false
});

// CORS configuration
const allowedOrigins = [
  'https://hein1.onrender.com',
  'https://test-d9o3.onrender.com',
  ...(process.env.NODE_ENV === 'development' ? [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ] : [])
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(generalLimiter);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Welcome to Hein AI Backend API',
    version: '2.0.0',
    endpoints: [
      '/health',
      '/api/register',
      '/api/login',
      '/api/chat',
      '/api/generate-image',
      '/api/chat/history',
      '/api/chat/:chatId',
      '/api/message/:messageId'
    ],
    features: [
      '🧠 Smart auto web search (AI decides when to search)',
      '⚡ Multi-source search (DuckDuckGo + Wikipedia)',
      '🎯 Priority source ranking',
      '⏱️ Optimized speed (<30s guaranteed)',
      '🤖 AI-enhanced prompts (chat & image)',
      '🔒 Secure with rate limiting'
    ]
  });
});

// Sanitize input utility
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return xss(input.trim(), {
    whiteList: {
      a: ['href', 'title', 'target'],
      img: ['src', 'alt'],
      b: [], strong: [], i: [], em: [], code: [], pre: [],
      ul: [], ol: [], li: [], p: [], br: [],
      h1: [], h2: [], h3: [], h4: [], h5: [], h6: []
    },
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script']
  });
}

// Validate UUID
function validateId(id) {
  return validate(id);
}

// Enhance prompt using AI with timeout
async function enhancePrompt(userPrompt, isImagePrompt = false) {
  try {
    console.log(`Starting prompt enhancement for: "${userPrompt}" (Image: ${isImagePrompt})`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const systemMessage = isImagePrompt
      ? 'You are a photo editing assistant. Translate the user\'s image request into English (if it isn\'t already) and edit it with artistic details to create a beautiful image. Keep the photo editing prompt under 70 characters. Focus on: style, lighting, composition. ABSOLUTELY no periods or commas. ONLY return the photo editing prompt, nothing else.'
      : 'You are a conversational AI assistant. Enhance the user\'s prompt to make it clearer and more detailed for better AI responses, while preserving the original intent. Keep the enhanced prompt under 200 characters. Return only the enhanced prompt, nothing else.';
    
    const enhanceMessages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: `Enhance this prompt: "${userPrompt}"` }
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hein1.onrender.com',
        'X-Title': 'Hein AI'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat-v3.1:free',
        messages: enhanceMessages,
        temperature: 0.7,
        max_tokens: isImagePrompt ? 100 : 200
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`Prompt enhancement failed: ${response.status}, using original prompt`);
      return userPrompt;
    }

    const data = await response.json();
    const enhancedPrompt = data.choices?.[0]?.message?.content?.trim() || userPrompt;
    
    const maxLength = isImagePrompt ? 200 : 500;
    const finalPrompt = enhancedPrompt.length > maxLength ? enhancedPrompt.substring(0, maxLength - 3) + '...' : enhancedPrompt;
    
    console.log(`Prompt enhanced successfully: "${finalPrompt}"`);
    return finalPrompt;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`Prompt enhancement timeout, using original prompt`);
    } else {
      console.warn(`Prompt enhancement error: ${error.message}, using original prompt`);
    }
    return userPrompt;
  }
}

// AI-powered decision: Should we search the web?
async function shouldSearchWeb(userMessage) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const decisionPrompt = [
      {
        role: 'system',
        content: `You are a search decision assistant. Analyze if the user's query requires real-time web search.
Reply ONLY with "YES" or "NO" (nothing else).

Search YES for:
- Current events, news, recent updates
- Real-time data (weather, stocks, scores)
- Specific facts you might not know
- Questions about people, places, or events after January 2025
- Requests explicitly asking for current/latest info

Search NO for:
- General knowledge, theories, explanations
- Coding help, math problems
- Creative writing, personal advice
- Philosophical discussions
- How-to questions with stable answers`
      },
      {
        role: 'user',
        content: `Should I search the web for this query?\n\nQuery: "${userMessage}"\n\nRespond only YES or NO.`
      }
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hein1.onrender.com',
        'X-Title': 'Hein AI'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat-v3.1:free',
        messages: decisionPrompt,
        temperature: 0.1,
        max_tokens: 10
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`Search decision failed, defaulting to NO`);
      return false;
    }

    const data = await response.json();
    const decision = data.choices?.[0]?.message?.content?.trim().toUpperCase() || 'NO';
    
    console.log(`🤖 Search decision: ${decision} for query: "${userMessage}"`);
    return decision === 'YES';
    
  } catch (error) {
    console.warn(`Search decision error: ${error.message}, defaulting to NO`);
    return false;
  }
}

// Multi-source web search with parallel requests
async function searchWithPrioritySources(query, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`🔍 Starting multi-source web search for: "${query}"`);
    const startTime = Date.now();
    
    const encodedQuery = encodeURIComponent(query);
    const results = [];
    
    // Priority domains for ranking
    const priorityDomains = [
      'wikipedia.org', 'vnexpress.net', 'thanhnien.vn', 'tuoitre.vn',
      'bbc.com', 'reuters.com', 'nytimes.com', 'cnn.com', 'theguardian.com',
      'stackoverflow.com', 'github.com', 'medium.com'
    ];
    
    // Search Promise 1: DuckDuckGo API
    const duckDuckGoSearch = async () => {
      try {
        const searchUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
        const response = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: controller.signal
        });

        if (!response.ok) return [];

        const data = await response.json();
        const ddgResults = [];
        
        if (data.Abstract && data.Abstract.length > 0) {
          ddgResults.push({
            title: data.Heading || 'Instant Answer',
            snippet: data.Abstract,
            link: data.AbstractURL || '',
            source: data.AbstractSource || 'DuckDuckGo',
            priority: 10
          });
        }
        
        if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
          for (const topic of data.RelatedTopics.slice(0, 6)) {
            if (topic.Text && topic.FirstURL) {
              try {
                const domain = new URL(topic.FirstURL).hostname;
                const isPriority = priorityDomains.some(pd => domain.includes(pd));
                
                ddgResults.push({
                  title: topic.Text.split(' - ')[0] || 'Related Topic',
                  snippet: topic.Text,
                  link: topic.FirstURL,
                  source: domain,
                  priority: isPriority ? 5 : 1
                });
              } catch (urlError) {
                // Skip invalid URLs
              }
            }
          }
        }
        
        return ddgResults;
      } catch (error) {
        console.warn(`DuckDuckGo search failed: ${error.message}`);
        return [];
      }
    };

    // Search Promise 2: Wikipedia Direct
    const wikipediaSearch = async () => {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&srlimit=3&origin=*`;
        const response = await fetch(wikiUrl, { signal: controller.signal });
        
        if (!response.ok) return [];
        
        const data = await response.json();
        const wikiResults = [];
        
        if (data.query && data.query.search) {
          for (const item of data.query.search) {
            wikiResults.push({
              title: item.title,
              snippet: item.snippet.replace(/<[^>]*>/g, ''),
              link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
              source: 'wikipedia.org',
              priority: 8
            });
          }
        }
        
        return wikiResults;
      } catch (error) {
        console.warn(`Wikipedia search failed: ${error.message}`);
        return [];
      }
    };

    // Execute searches in parallel with timeout
    const [ddgResults, wikiResults] = await Promise.allSettled([
      Promise.race([duckDuckGoSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('DDG timeout')), 12000))]),
      Promise.race([wikipediaSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('Wiki timeout')), 12000))])
    ]);

    // Combine results
    if (ddgResults.status === 'fulfilled' && ddgResults.value) {
      results.push(...ddgResults.value);
    }
    if (wikiResults.status === 'fulfilled' && wikiResults.value) {
      results.push(...wikiResults.value);
    }

    // Remove duplicates and sort by priority
    const uniqueResults = Array.from(
      new Map(results.map(r => [r.link, r])).values()
    );
    
    uniqueResults.sort((a, b) => b.priority - a.priority);
    const topResults = uniqueResults.slice(0, 8);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Multi-source search completed in ${elapsed}s, found ${topResults.length} results`);
    
    clearTimeout(timeout);
    return topResults;
    
  } catch (error) {
    clearTimeout(timeout);
    
    if (error.name === 'AbortError') {
      console.error(`Search timeout after ${timeoutMs}ms`);
      return [];
    }
    
    console.error(`Search error: ${error.message}`);
    return [];
  }
}

// Enhanced AI summarization with concise output and better formatting
async function summarizeSearchResults(query, searchResults, timeoutMs = 6000) {
  if (!searchResults || searchResults.length === 0) {
    return 'Không tìm thấy kết quả phù hợp. Vui lòng thử lại với từ khóa khác.';
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`🤖 Starting AI summarization for ${searchResults.length} results...`);
    const startTime = Date.now();
    
    // Format search results for AI - more concise
    const formattedResults = searchResults
      .slice(0, 6) // Limit to top 6 results for faster processing
      .map((r, i) => `[${i + 1}] ${r.title}\nSource: ${r.source}\nInfo: ${r.snippet.substring(0, 200)}`)
      .join('\n\n');
    
    const isVietnamese = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(query);
    
    const summaryMessages = [
      {
        role: 'system',
        content: `You are an expert information synthesizer. Create clear, accurate summaries from search results.

STRICT RULES:
- Language: ${isVietnamese ? 'Vietnamese ONLY' : 'English ONLY'}
- Start with direct answer (2-3 sentences)
- Add 3-5 key bullet points (use • not numbers)
- Cite sources: [1], [2], etc
- Maximum 200 words total
- Be factual, no speculation
- Use clear formatting with line breaks`
      },
      {
        role: 'user',
        content: `Query: "${query}"\n\nSearch Results:\n${formattedResults}\n\nSummarize concisely with source citations.`
      }
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hein1.onrender.com',
        'X-Title': 'Hein AI'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat-v3.1:free',
        messages: summaryMessages,
        temperature: 0.2,
        max_tokens: 350
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`AI summarization failed: ${response.status}`);
    }

    const data = await response.json();
    let summary = data.choices?.[0]?.message?.content?.trim() || 'Không thể tạo tóm tắt từ kết quả tìm kiếm.';
    
    // Clean up summary formatting
    summary = summary.replace(/\*\*/g, ''); // Remove bold markdown
    
    // Add source references with links
    const sourcesSection = '\n\n---\n**📚 Nguồn:**\n' + 
      searchResults
        .slice(0, 6)
        .map((r, i) => `[${i + 1}] [${r.source}](${r.link})`)
        .join(' • ');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Summarization completed in ${elapsed}s`);
    
    return summary + sourcesSection;
    
  } catch (error) {
    clearTimeout(timeout);
    
    if (error.name === 'AbortError') {
      console.error(`Summarization timeout after ${timeoutMs}ms`);
      return 'Thời gian xử lý quá lâu. Vui lòng thử lại.';
    }
    
    console.error(`Summarization error: ${error.message}`);
    return 'Không thể tạo tóm tắt. Vui lòng thử lại.';
  }
}

// Optimized smart polling function
async function verifyImageWithPolling(imageUrl) {
  const MAX_ATTEMPTS = 5;
  const INITIAL_DELAY = 2000;
  const POLL_INTERVAL = 800;
  
  console.log(`Starting smart polling for image: ${imageUrl}`);
  console.log(`Initial wait: ${INITIAL_DELAY}ms before first check`);
  await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY));
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`Polling attempt ${attempt}/${MAX_ATTEMPTS}`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(imageUrl, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        console.log(`Response status: ${response.status}, Content-Type: ${contentType}`);
        
        if (contentType && contentType.startsWith('image/')) {
          console.log(`✓ Image verified successfully on attempt ${attempt}`);
          return {
            success: true,
            attempts: attempt,
            contentType: contentType
          };
        }
      }
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn(`Attempt ${attempt} timed out after 3s`);
      } else {
        console.warn(`Attempt ${attempt} failed: ${error.message}`);
      }
    }
    
    if (attempt < MAX_ATTEMPTS) {
      console.log(`Waiting ${POLL_INTERVAL}ms before next check...`);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }
  
  console.error(`✗ Image verification failed after ${MAX_ATTEMPTS} attempts`);
  return {
    success: false,
    attempts: MAX_ATTEMPTS,
    error: 'Image generation timeout'
  };
}

// JWT authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    console.warn(`No token provided for ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'No token provided', code: 'NO_TOKEN' });
  }

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      console.warn(`Invalid token for ${req.method} ${req.originalUrl}: ${err.message}`);
      return res.status(403).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
    req.user = user;
    next();
  });
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const { error: supabaseError } = await supabase.from('users').select('id').limit(1);
    if (supabaseError) throw new Error(`Supabase connection failed: ${supabaseError.message}`);

    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${openRouterKey}` },
      timeout: 5000
    });
    if (!openRouterResponse.ok) throw new Error('OpenRouter connection failed');

    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'Hein AI Backend',
      version: '2.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dependencies: { supabase: 'connected', openRouter: 'connected', webSearch: 'enabled (multi-source)' }
    });
  } catch (error) {
    console.error(`Health check failed: ${error.message}`);
    res.status(503).json({
      status: 'ERROR',
      error: 'Service unhealthy',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Register endpoint
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields', code: 'INVALID_INPUT' });
    }

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedName = sanitizeInput(name);

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters', code: 'INVALID_PASSWORD' });
    }

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', sanitizedEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists', code: 'EMAIL_EXISTS' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase
      .from('users')
      .insert([{ email: sanitizedEmail, password: hashedPassword, name: sanitizedName }])
      .select()
      .single();

    if (error) {
      console.error(`Register error: ${error.message}`);
      return res.status(500).json({ error: 'Registration failed', code: 'DATABASE_ERROR' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
    console.info(`User registered: ${sanitizedEmail}`);
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error(`Register error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Login endpoint
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password', code: 'INVALID_INPUT' });
    }

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', sanitizedEmail)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
    console.info(`User logged in: ${sanitizedEmail}`);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error(`Login error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Chat endpoint with smart auto web search
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { messages, chatId, prompt } = req.body;
    console.info(`Processing chat request: userId=${req.user.id}, chatId=${chatId}, prompt=${prompt || 'none'}`);
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages format', code: 'INVALID_INPUT' });
    }

    if (prompt && (typeof prompt !== 'string' || prompt.trim().length === 0)) {
      return res.status(400).json({ error: 'Invalid prompt format', code: 'INVALID_PROMPT' });
    }

    if (prompt && prompt.length > 500) {
      return res.status(400).json({ error: 'Prompt too long (max 500 characters)', code: 'PROMPT_TOO_LONG' });
    }

    const userId = req.user.id;
    let newChatId = chatId;

    if (chatId && !validateId(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    // Create or verify chat
    if (!chatId) {
      const firstMessage = sanitizeInput(prompt || messages[0]?.content || 'New chat');
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .insert([{ user_id: userId, title: firstMessage.substring(0, 50) }])
        .select()
        .single();

      if (chatError) {
        console.error(`Create chat error: ${chatError.message}`);
        return res.status(500).json({ error: 'Failed to create chat', code: 'DATABASE_ERROR' });
      }
      newChatId = chat.id;
    } else {
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chatId)
        .eq('user_id', userId)
        .maybeSingle();

      if (chatError || !chat) {
        return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND' });
      }
      newChatId = chat.id;
    }

    // Save user message
    const userContent = prompt ? sanitizeInput(prompt) : sanitizeInput(messages.filter(m => m.role === 'user').pop()?.content || '');
    if (!userContent) {
      return res.status(400).json({ error: 'No valid user message or prompt provided', code: 'INVALID_INPUT' });
    }

    await supabase
      .from('messages')
      .insert([{
        chat_id: newChatId,
        role: 'user',
        content: userContent,
        timestamp: new Date().toISOString()
      }]);

    // SMART DECISION: Should we search the web?
    const overallStartTime = Date.now();
    let aiMessage = '';
    let enhancedPromptUsed = false;
    let finalPrompt = userContent;
    let wasWebSearch = false;
    
    // Check for explicit search keywords OR use AI decision
    const searchKeywords = ['tìm kiếm web:', 'web search:', 'search:', 'tìm:', 'tra cứu:', 'search web:'];
    const hasSearchKeyword = searchKeywords.some(keyword => 
      userContent.toLowerCase().startsWith(keyword.toLowerCase())
    );
    
    let shouldSearch = hasSearchKeyword;
    
    // If no explicit keyword, let AI decide (parallel with timeout)
    if (!hasSearchKeyword) {
      console.log(`🤔 No search keyword detected, asking AI for decision...`);
      const decisionPromise = shouldSearchWeb(userContent);
      const decisionWithTimeout = Promise.race([
        decisionPromise,
        new Promise(resolve => setTimeout(() => resolve(false), 5000))
      ]);
      
      shouldSearch = await decisionWithTimeout;
    }

    if (shouldSearch) {
      wasWebSearch = true;
      console.log(`🔍 Executing web search (${hasSearchKeyword ? 'keyword' : 'AI decision'})...`);
      
      // Extract query if keyword present
      let searchQuery = userContent;
      if (hasSearchKeyword) {
        for (const keyword of searchKeywords) {
          if (userContent.toLowerCase().startsWith(keyword.toLowerCase())) {
            searchQuery = userContent.substring(keyword.length).trim();
            break;
          }
        }
      }
      
      console.log(`Search query: "${searchQuery}"`);
      
      // Execute search with strict 25s timeout
      const searchResults = await Promise.race([
        searchWithPrioritySources(searchQuery, 25000),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Search timeout')), 27000)
        )
      ]).catch(err => {
        console.error(`Search failed: ${err.message}`);
        return [];
      });
      
      if (searchResults.length > 0) {
        console.log(`Found ${searchResults.length} results, summarizing...`);
        // Summarize with 6s timeout
        aiMessage = await Promise.race([
          summarizeSearchResults(searchQuery, searchResults, 6000),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Summarization timeout')), 8000)
          )
        ]).catch(err => {
          console.error(`Summarization failed: ${err.message}`);
          return 'Không thể tóm tắt kết quả. Vui lòng thử lại.';
        });
      } else {
        aiMessage = hasSearchKeyword 
          ? 'Không tìm thấy kết quả phù hợp. Vui lòng thử lại với từ khóa khác.'
          : 'Xin lỗi, tôi không tìm thấy thông tin liên quan. Bạn có thể hỏi câu khác không?';
      }
      
    } else {
      // Regular AI chat (no search)
      console.log(`💬 Processing as regular chat (no search needed)`);
      
      // Enhance prompt if provided
      if (prompt) {
        const enhancedResult = await enhancePrompt(userContent, false);
        if (enhancedResult !== userContent) {
          finalPrompt = enhancedResult;
          enhancedPromptUsed = true;
        }
      }

      // Prepare messages for OpenRouter
      const mappedMessages = messages.map(m => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: sanitizeInput(m.content)
      }));

      if (enhancedPromptUsed) {
        mappedMessages[mappedMessages.length - 1] = {
          role: 'user',
          content: finalPrompt
        };
      }

      const messagesWithSystem = [
        {
          role: 'system',
          content: 'You are Hein, an AI created by Hien2309. Always answer in the language the user uses. Provide accurate, concise, practical answers with no fabrication. Use active voice, add examples/data when possible. You may switch to use mild swearing if the user does first. Avoid vagueness, exaggeration, hashtags, markdown, semicolons.'
        },
        ...mappedMessages
      ];

      // AI response with timeout
      const response = await Promise.race([
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://hein1.onrender.com',
            'X-Title': 'Hein AI'
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat-v3.1:free',
            messages: messagesWithSystem
          })
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI timeout')), 15000)
        )
      ]).catch(err => {
        console.error(`AI request failed: ${err.message}`);
        return null;
      });

      if (!response || !response.ok) {
        console.error(`OpenRouter error: ${response?.status || 'timeout'}`);
        return res.status(500).json({ error: 'AI service error', code: 'AI_SERVICE_ERROR' });
      }

      const data = await response.json();
      aiMessage = data.choices?.[0]?.message?.content || 'No response from AI';
      if (enhancedPromptUsed) {
        aiMessage = `${aiMessage}\n\n*Enhanced prompt: ${finalPrompt}*`;
      }
    }

    // Calculate total time
    const totalElapsed = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    
    // Add timing info for web search
    if (wasWebSearch) {
      aiMessage += `\n\n*⏱️ Total: ${totalElapsed}s*`;
    }

    // Save AI message
    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([{
        chat_id: newChatId,
        role: 'ai',
        content: sanitizeInput(aiMessage),
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();

    if (messageError) {
      console.error(`Save message error: ${messageError.message}`);
      return res.status(500).json({ error: 'Failed to save message', code: 'DATABASE_ERROR' });
    }

    // Update chat
    await supabase
      .from('chats')
      .update({
        last_message: sanitizeInput(userContent).substring(0, 100),
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    console.info(`Chat message processed: chatId=${newChatId}, webSearch=${wasWebSearch}, time=${totalElapsed}s`);
    res.json({
      message: aiMessage,
      messageId: savedMessage.id,
      chatId: newChatId,
      timestamp: savedMessage.timestamp,
      enhancedPrompt: enhancedPromptUsed ? finalPrompt : undefined,
      originalPrompt: enhancedPromptUsed ? userContent : undefined,
      isWebSearch: wasWebSearch,
      searchTime: wasWebSearch ? `${totalElapsed}s` : undefined
    });
  } catch (err) {
    console.error(`Chat endpoint error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Generate image endpoint - OPTIMIZED with Proxy
app.post('/api/generate-image', authenticateToken, imageLimiter, async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    console.info(`Generate image request: userId=${req.user.id}, chatId=${chatId}, prompt=${prompt}`);
    
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid or missing prompt', code: 'INVALID_INPUT' });
    }

    if (prompt.length > 500) {
      return res.status(400).json({ error: 'Prompt too long (max 500 characters)', code: 'PROMPT_TOO_LONG' });
    }

    const sanitizedPrompt = sanitizeInput(prompt);
    const userId = req.user.id;
    let newChatId = chatId;

    if (chatId && !validateId(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    // Create or verify chat
    if (!chatId) {
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .insert([{ user_id: userId, title: `Image: ${sanitizedPrompt.substring(0, 40)}` }])
        .select()
        .single();

      if (chatError) {
        console.error(`Create chat error: ${chatError.message}`);
        return res.status(500).json({ error: 'Failed to create chat', code: 'DATABASE_ERROR' });
      }
      newChatId = chat.id;
    } else {
      const { data: chat } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chatId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!chat) {
        return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND' });
      }
      newChatId = chat.id;
    }

    // Save user message
    await supabase
      .from('messages')
      .insert([{
        chat_id: newChatId,
        role: 'user',
        content: sanitizedPrompt,
        timestamp: new Date().toISOString()
      }]);

    // Enhance prompt
    console.log(`Enhancing prompt with AI...`);
    const startTime = Date.now();
    
    const enhancedPrompt = await enhancePrompt(sanitizedPrompt, true);
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;

    // Fetch the image to proxy
    console.log(`Fetching image from: ${imageUrl}`);
    const imageResponse = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'Accept': 'image/*'
      }
    });

    if (!imageResponse.ok) {
      console.error(`Image fetch failed: ${imageResponse.status}`);
      return res.status(500).json({ error: 'Failed to fetch image', code: 'IMAGE_FETCH_ERROR' });
    }

    const contentType = imageResponse.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      console.error(`Invalid content type: ${contentType}`);
      return res.status(500).json({ error: 'Invalid image response', code: 'INVALID_IMAGE_RESPONSE' });
    }

    // Optionally store the image in Supabase storage
    const imageId = uuidv4();
    const imageBuffer = await imageResponse.buffer();
    let finalImageUrl = imageUrl;

    const { error: storageError } = await supabase.storage
      .from('images')
      .upload(`public/${imageId}.png`, imageBuffer, {
        contentType: contentType,
        upsert: true
      });

    if (storageError) {
      console.warn(`Storage error: ${storageError.message}, falling back to external URL`);
    } else {
      const { data: signedUrlData } = await supabase.storage
        .from('images')
        .createSignedUrl(`public/${imageId}.png`, 60 * 60 * 24); // 1-day expiration
      finalImageUrl = signedUrlData?.signedUrl || imageUrl;
    }

    console.info(`Generated image URL with enhanced prompt`);

    // Smart polling (optional, since we already fetched the image)
    console.log(`Starting smart polling verification...`);
    const verificationResult = await verifyImageWithPolling(finalImageUrl);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (!verificationResult.success) {
      console.warn(`Image verification failed, returning unverified URL`);
    }

    console.log(`${verificationResult.success ? '✓' : '✗'} Image process completed in ${totalTime}s`);

    // Save AI message
    const messageContent = verificationResult.success 
      ? `![Generated Image](${finalImageUrl})\n\n*Enhanced prompt: ${enhancedPrompt}*\n*Verified in ${totalTime}s (${verificationResult.attempts} checks)*`
      : `![Generated Image](${finalImageUrl})\n\n*Enhanced prompt: ${enhancedPrompt}*\n*Generated in ${totalTime}s (verification skipped)*`;

    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([{
        chat_id: newChatId,
        role: 'ai',
        content: messageContent,
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();

    if (messageError) {
      console.error(`Save image message error: ${messageError.message}`);
      return res.status(500).json({ error: 'Failed to save message', code: 'DATABASE_ERROR' });
    }

    // Update chat
    await supabase
      .from('chats')
      .update({
        last_message: `Image: ${sanitizedPrompt.substring(0, 50)}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    console.info(`Image generated: chatId=${newChatId}, messageId=${savedMessage.id}, time=${totalTime}s`);
    
    res.json({
      message: messageContent,
      imageUrl: finalImageUrl,
      enhancedPrompt: enhancedPrompt,
      originalPrompt: sanitizedPrompt,
      messageId: savedMessage.id,
      chatId: newChatId,
      timestamp: savedMessage.timestamp,
      verification: {
        verified: verificationResult.success,
        attempts: verificationResult.attempts,
        totalTime: `${totalTime}s`,
        contentType: verificationResult.contentType || 'unknown'
      }
    });
  } catch (err) {
    console.error(`Image generation error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Chat history endpoint
app.get('/api/chat/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 50);
    const offset = (page - 1) * limit;

    const { data: chats, error: chatError } = await supabase
      .from('chats')
      .select('id, title, last_message, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (chatError) {
      console.error(`Chat history query error: ${chatError.message}`);
      return res.status(500).json({ error: 'Failed to fetch chat history', code: 'DATABASE_ERROR' });
    }

    const history = await Promise.all(chats.map(async (chat) => {
      const { data: messages } = await supabase
        .from('messages')
        .select('id, role, content, timestamp')
        .eq('chat_id', chat.id)
        .order('timestamp', { ascending: true })
        .limit(100);

      return { ...chat, messages: messages || [] };
    }));

    console.info(`Chat history retrieved: userId=${userId}, chats=${chats.length}`);
    res.json({ history, page, limit });
  } catch (err) {
    console.error(`Chat history error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Delete chat endpoint
app.delete('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    if (!validateId(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    const { data: chat } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND' });
    }

    await supabase.from('messages').delete().eq('chat_id', chatId);
    await supabase.from('chats').delete().eq('id', chatId).eq('user_id', userId);

    console.info(`Chat deleted: chatId=${chatId}`);
    res.json({ message: 'Chat deleted successfully', chatId });
  } catch (err) {
    console.error(`Delete chat error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Delete message endpoint
app.delete('/api/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    if (!validateId(messageId)) {
      console.warn(`Invalid message ID format: ${messageId}`);
      return res.status(400).json({ error: 'Invalid message ID format', code: 'INVALID_MESSAGE_ID' });
    }

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('chat_id')
      .eq('id', messageId)
      .maybeSingle();

    if (messageError || !message) {
      console.warn(`Message not found: messageId=${messageId}`);
      return res.status(404).json({ error: 'Message not found', code: 'MESSAGE_NOT_FOUND', details: process.env.NODE_ENV === 'development' ? messageError?.message : undefined });
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', message.chat_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (chatError || !chat) {
      console.warn(`Chat not found or unauthorized: chatId=${message.chat_id}, userId=${userId}`);
      return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND', details: process.env.NODE_ENV === 'development' ? chatError?.message : undefined });
    }

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (deleteError) {
      console.error(`Delete message error: ${deleteError.message}`);
      return res.status(500).json({ error: 'Failed to delete message', code: 'DATABASE_ERROR', details: process.env.NODE_ENV === 'development' ? deleteError.message : undefined });
    }

    // Update chat's last_message
    const { data: lastMessage, error: lastMessageError } = await supabase
      .from('messages')
      .select('content')
      .eq('chat_id', message.chat_id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastMessageError && lastMessage) {
      await supabase
        .from('chats')
        .update({
          last_message: sanitizeInput(lastMessage.content).substring(0, 100),
          updated_at: new Date().toISOString()
        })
        .eq('id', message.chat_id);
    }

    console.info(`Message deleted: messageId=${messageId}, userId=${userId}`);
    res.json({ message: 'Message deleted successfully', messageId });
  } catch (err) {
    console.error(`Delete message error: ${err.message}, stack: ${err.stack}`);
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Catch-all handler for SPA routing
app.get('*', (req, res) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found', code: 'NOT_FOUND' });
  }
  
  const indexPath = path.join(__dirname, 'test', 'frontend', 'dist', 'index.html');
  console.log(`Serving SPA for ${req.originalUrl}`);
  
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error(`Error serving index.html: ${err.message}`);
      res.status(500).json({ error: 'Failed to serve application', code: 'SERVE_ERROR' });
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Unhandled error: ${err.message}, stack: ${err.stack}`);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS error',
      code: 'CORS_ERROR',
      message: 'Origin not allowed'
    });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Graceful shutdown
const server = app.listen(process.env.PORT || 3001, () => {
  console.info(`Server started on port ${process.env.PORT || 3001}`);
  console.info(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.info(`CORS origins: ${allowedOrigins.join(', ')}`);
  console.info(`Smart auto web search: enabled (AI-powered decisions)`);
  console.info(`Multi-source search: DuckDuckGo + Wikipedia`);
  console.info(`Search timeout: <30s guaranteed`);
  console.info(`AI-enhanced prompts: enabled (chat and image)`);
});

process.on('SIGTERM', () => {
  console.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.info('Server closed');
    process.exit(0);
  });
});
