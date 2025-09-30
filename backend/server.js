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
  windowMs: 60 * 1000, // 1 minute
  max: 10,
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

// Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(generalLimiter);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Welcome to Hein AI Backend API',
    version: '1.0.3',
    endpoints: [
      '/health',
      '/api/register',
      '/api/login',
      '/api/chat',
      '/api/generate-image',
      '/api/chat/history',
      '/api/chat/:chatId',
      '/api/message/:messageId'
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

// Enhance image prompt using AI
async function enhanceImagePrompt(userPrompt) {
  try {
    console.log(`Starting prompt enhancement for: "${userPrompt}"`);
    
    const enhanceMessages = [
      {
        role: 'system',
        content: 'You are a prompt enhancement assistant. Translate the user\'s image request to English (if not already) and enhance it with artistic details to create a beautiful image. Keep the enhanced prompt under 200 characters. Focus on: style, lighting, composition, and mood. Return ONLY the enhanced prompt, nothing else.'
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
      timeout: 10000
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn(`Prompt enhancement failed: ${response.status}, using original prompt`);
      return userPrompt;
    }

    const data = await response.json();
    const enhancedPrompt = data.choices?.[0]?.message?.content?.trim() || userPrompt;
    
    // Ensure prompt is not too long
    const finalPrompt = enhancedPrompt.length > 200 ? enhancedPrompt.substring(0, 197) + '...' : enhancedPrompt;
    
    console.log(`Prompt enhanced successfully: "${finalPrompt}"`);
    return finalPrompt;
  } catch (error) {
    console.warn(`Prompt enhancement error: ${error.message}, using original prompt`);
    return userPrompt;
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
      version: '1.0.3',
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

    const { data: existingUser, error: userError } = await supabase
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
      return res.status(500).json({ error: 'Registration failed', code: 'DATABASE_ERROR', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
    console.info(`User registered: ${sanitizedEmail}`);
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error(`Register error: ${err.message}`);
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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
        return res.status(500).json({ error: 'Failed to create chat', code: 'DATABASE_ERROR', details: process.env.NODE_ENV === 'development' ? chatError.message : undefined });
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
        return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND', details: process.env.NODE_ENV === 'development' ? chatError?.message : undefined });
      }
      newChatId = chat.id;
    }

    // Save user message first
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (lastUserMessage) {
      const { error: userMsgError } = await supabase
        .from('messages')
        .insert([{
          chat_id: newChatId,
          role: 'user',
          content: sanitizeInput(lastUserMessage.content),
          timestamp: new Date().toISOString()
        }]);

      if (userMsgError) {
        console.warn(`Save user message error: ${userMsgError.message}`);
      }
    }

    // Map 'ai' role to 'assistant' for OpenRouter
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
      const errorData = await response.json().catch(() => ({}));
      console.error(`OpenRouter error: status=${response.status}, error=${JSON.stringify(errorData)}`);
      return res.status(500).json({ error: 'AI service error', code: 'AI_SERVICE_ERROR', details: process.env.NODE_ENV === 'development' ? errorData.error : undefined });
    }

    const data = await response.json();
    const aiMessage = data.choices?.[0]?.message?.content || 'No response from AI';

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
      return res.status(500).json({ error: 'Failed to save message', code: 'DATABASE_ERROR', details: process.env.NODE_ENV === 'development' ? messageError.message : undefined });
    }

    // Update chat with last message
    const { error: updateError } = await supabase
      .from('chats')
      .update({
        last_message: sanitizeInput(lastUserMessage?.content || 'Chat').substring(0, 100),
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    if (updateError) {
      console.warn(`Update chat error: ${updateError.message}`);
    }

    console.info(`Chat message processed: chatId=${newChatId}, userId=${userId}`);
    res.json({
      message: aiMessage,
      messageId: savedMessage.id,
      chatId: newChatId,
      timestamp: savedMessage.timestamp
    });
  } catch (err) {
    console.error(`Chat endpoint error: ${err.message}, stack: ${err.stack}`);
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Generate image endpoint with AI-enhanced prompts
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
      console.warn(`Invalid chat ID format: ${chatId}`);
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    // Create or verify chat
    if (!chatId) {
      console.log(`Creating new chat for userId=${userId}`);
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .insert([{ user_id: userId, title: `Image: ${sanitizedPrompt.substring(0, 40)}` }])
        .select()
        .single();

      if (chatError) {
        console.error(`Create chat error: ${chatError.message}`);
        return res.status(500).json({ error: 'Failed to create chat', code: 'DATABASE_ERROR', details: process.env.NODE_ENV === 'development' ? chatError.message : undefined });
      }
      newChatId = chat.id;
      console.info(`New chat created: chatId=${newChatId}`);
    } else {
      console.log(`Verifying chat: chatId=${chatId}, userId=${userId}`);
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chatId)
        .eq('user_id', userId)
        .maybeSingle();

      if (chatError || !chat) {
        console.error(`Chat not found: chatId=${chatId}`);
        return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND', details: process.env.NODE_ENV === 'development' ? chatError?.message : undefined });
      }
      newChatId = chat.id;
    }

    // Save user message first (original prompt)
    const { error: userMsgError } = await supabase
      .from('messages')
      .insert([{
        chat_id: newChatId,
        role: 'user',
        content: sanitizedPrompt,
        timestamp: new Date().toISOString()
      }]);

    if (userMsgError) {
      console.warn(`Save user message error: ${userMsgError.message}`);
    }

    // Enhance prompt using AI
    console.log(`Enhancing prompt with AI...`);
    const enhancedPrompt = await enhanceImagePrompt(sanitizedPrompt);
    console.log(`Using enhanced prompt for image generation`);

    // Generate image URL using enhanced prompt
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;
    
    console.info(`Generated image URL with enhanced prompt`);

    // Verify the image URL is accessible
    try {
      const verifyResponse = await fetch(imageUrl, { 
        method: 'HEAD',
        timeout: 10000
      });
      
      if (!verifyResponse.ok) {
        console.error(`Image URL not accessible: status=${verifyResponse.status}`);
        return res.status(500).json({
          error: 'Failed to generate image',
          code: 'IMAGE_GENERATION_ERROR',
          details: process.env.NODE_ENV === 'development' ? `Status: ${verifyResponse.status}` : undefined
        });
      }
    } catch (verifyError) {
      console.error(`Image verification failed: ${verifyError.message}`);
      return res.status(500).json({
        error: 'Failed to verify image',
        code: 'IMAGE_VERIFICATION_ERROR',
        details: process.env.NODE_ENV === 'development' ? verifyError.message : undefined
      });
    }

    // Save AI message with image markdown and enhanced prompt info
    const messageContent = `![Generated Image](${imageUrl})\n\n*Enhanced prompt: ${enhancedPrompt}*`;

    console.log(`Saving message to Supabase: chatId=${newChatId}`);
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
      return res.status(500).json({ error: 'Failed to save message', code: 'DATABASE_ERROR', details: process.env.NODE_ENV === 'development' ? messageError.message : undefined });
    }

    // Update chat
    console.log(`Updating chat: chatId=${newChatId}`);
    const { error: updateError } = await supabase
      .from('chats')
      .update({
        last_message: `Image: ${sanitizedPrompt.substring(0, 50)}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    if (updateError) {
      console.warn(`Update chat error: ${updateError.message}`);
    }

    console.info(`Image generated successfully: chatId=${newChatId}, userId=${userId}, messageId=${savedMessage.id}`);
    res.json({
      message: messageContent,
      imageUrl: imageUrl,
      enhancedPrompt: enhancedPrompt,
      originalPrompt: sanitizedPrompt,
      messageId: savedMessage.id,
      chatId: newChatId,
      timestamp: savedMessage.timestamp
    });
  } catch (err) {
    console.error(`Image generation error: ${err.message}, stack: ${err.stack}`);
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Chat history endpoint
app.get('/api/chat/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 50);
    const offset = (page - 1) * limit;

    console.info(`Fetching chat history: userId=${userId}, page=${page}, limit=${limit}`);

    const { data: chats, error: chatError } = await supabase
      .from('chats')
      .select('id, title, last_message, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (chatError) {
      console.error(`Chat history query error: ${chatError.message}`);
      return res.status(500).json({ error: 'Failed to fetch chat history', code: 'DATABASE_ERROR', details: process.env.NODE_ENV === 'development' ? chatError.message : undefined });
    }

    const history = await Promise.all(chats.map(async (chat) => {
      const { data: messages, error: messageError } = await supabase
        .from('messages')
        .select('id, role, content, timestamp')
        .eq('chat_id', chat.id)
        .order('timestamp', { ascending: true })
        .limit(100);

      if (messageError) {
        console.warn(`Messages query error for chat ${chat.id}: ${messageError.message}`);
        return { ...chat, messages: [] };
      }
      return { ...chat, messages: messages || [] };
    }));

    console.info(`Chat history retrieved: userId=${userId}, chats=${chats.length}`);
    res.json({ history, page, limit });
  } catch (err) {
    console.error(`Chat history error: ${err.message}, stack: ${err.stack}`);
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Delete chat endpoint
app.delete('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    console.info(`Delete chat request: chatId=${chatId}, userId=${userId}`);

    if (!validateId(chatId)) {
      console.warn(`Invalid chat ID format: ${chatId}`);
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    // Verify chat exists and belongs to user
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', userId)
      .maybeSingle();

    if (chatError || !chat) {
      console.error(`Chat not found: chatId=${chatId}`);
      return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND', details: process.env.NODE_ENV === 'development' ? chatError?.message : undefined });
    }

    // Delete messages first (if cascade is not set up)
    const { error: deleteMessagesError } = await supabase
      .from('messages')
      .delete()
      .eq('chat_id', chatId);

    if (deleteMessagesError) {
      console.warn(`Delete messages error: ${deleteMessagesError.message}`);
    }

    // Delete chat
    const { error: deleteChatError } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId)
      .eq('user_id', userId);

    if (deleteChatError) {
      console.error(`Delete chat error: ${deleteChatError.message}`);
      return res.status(500).json({
        error: 'Failed to delete chat',
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? deleteChatError.message : undefined
      });
    }

    console.info(`Chat deleted: chatId=${chatId}, userId=${userId}`);
    res.json({ message: 'Chat deleted successfully', chatId });
  } catch (err) {
    console.error(`Delete chat error: ${err.message}, stack: ${err.stack}`);
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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
