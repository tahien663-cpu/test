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

const { default: cheerio } = await import('cheerio');

dotenv.config();

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

// Serve static files for frontend (assuming build folder is present)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'build'))); // Adjust 'build' to your frontend build directory

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
      connectSrc: ["'self'", "https://openrouter.ai", "https://image.pollinations.ai"],
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
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Too many image generation requests, please try again after 1 hour' },
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
    version: '1.0.5',
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
      'AI-enhanced image prompts',
      'Optimized smart polling (2s + 5x0.8s)',
      'Rate limit: 15 images/min'
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

// Enhance image prompt using AI with timeout
async function enhanceImagePrompt(userPrompt) {
  try {
    console.log(`Starting prompt enhancement for: "${userPrompt}"`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const enhanceMessages = [
      {
        role: 'system',
        content: 'You are a photo editing assistant. Translate the user\'s image request into English (if it isn\'t already) and edit it with artistic details to create a beautiful image. Keep the photo editing prompt under 60 characters. Focus on: style, lighting, composition.ABSOLUTELY no periods or commas. ONLY return the photo editing prompt, nothing else.'
      },
      {
        role: 'user',
        content: `Enhance this image prompt: "${userPrompt}"`
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
        model: 'x-ai/grok-4-fast:free',
        messages: enhanceMessages,
        temperature: 0.7,
        max_tokens: 100
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
    
    const finalPrompt = enhancedPrompt.length > 200 ? enhancedPrompt.substring(0, 197) + '...' : enhancedPrompt;
    
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

// Function to search DuckDuckGo and extract results
async function searchDuckDuckGo(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(`https://duckduckgo.com/html/?q=${encodedQuery}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];

    $('.result').each((i, el) => {
      if (i >= 5) return false; // Limit to top 5 results
      
      const title = $(el).find('.result__title').text().trim();
      const link = $(el).find('.result__a').attr('href');
      const snippet = $(el).find('.result__snippet').text().trim();
      
      if (title && link && snippet) {
        results.push({ title, link, snippet });
      }
    });

    return results;
  } catch (error) {
    console.error(`DuckDuckGo search error: ${error.message}`);
    return [];
  }
}

// Function to summarize search results with AI
async function summarizeWithAI(query, searchResults) {
  try {
    const summaryMessages = [
      {
        role: 'system',
        content: 'You are a helpful assistant that summarizes web search results concisely. If the user query is short (under 20 words), keep your response brief and to the point. Structure the summary with key points, sources, and be accurate. Respond in Vietnamese if the query is in Vietnamese.'
      },
      {
        role: 'user',
        content: `Summarize these search results for the query "${query}":\n\n${searchResults.map(r => `- ${r.title}: ${r.snippet} (Source: ${r.link})`).join('\n')}`
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
        model: 'x-ai/grok-4-fast:free',
        messages: summaryMessages,
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`AI summarization failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'No summary available.';
  } catch (error) {
    console.error(`AI summarization error: ${error.message}`);
    return 'Failed to summarize results.';
  }
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
      version: '1.0.5',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dependencies: { supabase: 'connected', openRouter: 'connected' }
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

// Chat endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { messages, chatId } = req.body;
    console.info(`Processing chat request: userId=${req.user.id}, chatId=${chatId}`);
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages format', code: 'INVALID_INPUT' });
    }

    const userId = req.user.id;
    let newChatId = chatId;

    if (chatId && !validateId(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    // Create or verify chat
    if (!chatId) {
      const firstMessage = sanitizeInput(messages[0]?.content || 'New chat');
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
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (lastUserMessage) {
      await supabase
        .from('messages')
        .insert([{
          chat_id: newChatId,
          role: 'user',
          content: sanitizeInput(lastUserMessage.content),
          timestamp: new Date().toISOString()
        }]);
    }

    // Check if this is a web search request
    let aiMessage = '';
    const userContent = lastUserMessage?.content || '';
    const isWebSearch = userContent.toLowerCase().startsWith('tìm kiếm web:');

    if (isWebSearch) {
      const searchQuery = userContent.replace(/^tìm kiếm web:/i, '').trim();
      const searchResults = await searchDuckDuckGo(searchQuery);
      
      if (searchResults.length > 0) {
        aiMessage = await summarizeWithAI(searchQuery, searchResults);
      } else {
        aiMessage = 'Không tìm thấy kết quả phù hợp. Vui lòng thử lại với từ khóa khác.';
      }
    } else {
      // Regular AI response
      // Map messages for OpenRouter
      const mappedMessages = messages.map(m => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: sanitizeInput(m.content)
      }));

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein1.onrender.com',
          'X-Title': 'Hein AI'
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: mappedMessages
        })
      });

      if (!response.ok) {
        console.error(`OpenRouter error: ${response.status}`);
        return res.status(500).json({ error: 'AI service error', code: 'AI_SERVICE_ERROR' });
      }

      const data = await response.json();
      aiMessage = data.choices?.[0]?.message?.content || 'No response from AI';
    }

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
        last_message: sanitizeInput(lastUserMessage?.content || 'Chat').substring(0, 100),
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    console.info(`Chat message processed: chatId=${newChatId}`);
    res.json({
      message: aiMessage,
      messageId: savedMessage.id,
      chatId: newChatId,
      timestamp: savedMessage.timestamp
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
    
    const enhancedPrompt = await enhanceImagePrompt(sanitizedPrompt);
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

// Catch-all handler for SPA routing (fixes refresh 404)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
  console.warn(`Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'ENDPOINT_NOT_FOUND',
    path: req.originalUrl
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Unhandled error: ${err.message}, stack: ${err.stack}`);
  
  // Handle CORS errors
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
  console.info(`AI-enhanced image prompts: enabled`);
  console.info(`Smart polling verification: enabled (2s initial + 5x0.8s checks)`);
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
