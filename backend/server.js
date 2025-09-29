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

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests
  message: { error: 'Too many login/register attempts, please try again after 15 minutes' },
  skipSuccessfulRequests: true
});

// CORS configuration
const allowedOrigins = [
  'https://hein1.onrender.com',
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(generalLimiter);

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
    if (supabaseError) throw new Error('Supabase connection failed');

    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${openRouterKey}` }
    });
    if (!openRouterResponse.ok) throw new Error('OpenRouter connection failed');

    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'Hein AI Backend',
      version: '1.0.1',
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

    const sanitizedEmail = sanitizeInput(email);
    const sanitizedName = sanitizeInput(name);

    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', sanitizedEmail)
      .single();

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

    const sanitizedEmail = sanitizeInput(email);
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', sanitizedEmail)
      .single();

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
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format', code: 'INVALID_INPUT' });
    }

    const userId = req.user.id;
    let newChatId = chatId;

    if (chatId && !validateId(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

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
        .single();

      if (chatError || !chat) {
        return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND' });
      }
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'x-ai/grok-4-fast:free',
        messages: messages.map(m => ({
          role: m.role,
          content: sanitizeInput(m.content)
        }))
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`OpenRouter error: ${errorData.error || response.statusText}`);
      return res.status(500).json({ error: 'AI service error', code: 'AI_SERVICE_ERROR' });
    }

    const { choices } = await response.json();
    const aiMessage = choices[0]?.message?.content || 'No response from AI';

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

    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const { error: updateError } = await supabase
      .from('chats')
      .update({
        last_message: sanitizeInput(lastUserMessage.content).substring(0, 100),
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
    console.error(`Chat error: ${err.message}`);
    res.status(500).json({
      error: 'Server error',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Image generation endpoint
app.post('/api/generate-image', authenticateToken, async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt', code: 'INVALID_INPUT' });
    }

    const sanitizedPrompt = sanitizeInput(prompt);
    const userId = req.user.id;
    let newChatId = chatId;

    if (chatId && !validateId(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    if (!chatId) {
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .insert([{ user_id: userId, title: sanitizedPrompt.substring(0, 50) }])
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
        .single();

      if (chatError || !chat) {
        return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND' });
      }
    }

    const response = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(sanitizedPrompt)}`, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      console.error(`Image generation error: ${response.statusText}`);
      return res.status(500).json({ error: 'Failed to generate image', code: 'IMAGE_GENERATION_ERROR' });
    }

    const imageUrl = await response.text();
    const messageContent = `![Generated Image](${imageUrl})`;

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

    const { error: updateError } = await supabase
      .from('chats')
      .update({
        last_message: 'Generated image',
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    if (updateError) {
      console.warn(`Update chat error: ${updateError.message}`);
    }

    console.info(`Image generated: chatId=${newChatId}, userId=${userId}`);
    res.json({
      message: messageContent,
      messageId: savedMessage.id,
      chatId: newChatId,
      timestamp: savedMessage.timestamp
    });
  } catch (err) {
    console.error(`Image generation error: ${err.message}`);
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
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const offset = (page - 1) * limit;

    const { data: chats, error: chatError } = await supabase
      .from('chats')
      .select('id, title, last_message, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (chatError) {
      console.error(`Get chat history error: ${chatError.message}`);
      return res.status(500).json({ error: 'Failed to fetch chat history', code: 'DATABASE_ERROR' });
    }

    const history = await Promise.all(chats.map(async (chat) => {
      const { data: messages, error: messageError } = await supabase
        .from('messages')
        .select('id, role, content, timestamp')
        .eq('chat_id', chat.id)
        .order('timestamp', { ascending: true })
        .limit(50);

      if (messageError) {
        console.warn(`Get messages error for chat ${chat.id}: ${messageError.message}`);
        return { ...chat, messages: [] };
      }
      return { ...chat, messages };
    }));

    console.info(`Chat history retrieved: userId=${userId}, page=${page}, limit=${limit}`);
    res.json({ history });
  } catch (err) {
    console.error(`Chat history error: ${err.message}`);
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

    if (!validateId(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID format', code: 'INVALID_CHAT_ID' });
    }

    const { error: transactionError } = await supabase.rpc('delete_chat_with_messages', {
      p_chat_id: chatId,
      p_user_id: userId
    });

    if (transactionError) {
      console.error(`Delete chat error: ${transactionError.message}`);
      return res.status(500).json({
        error: 'Failed to delete chat',
        code: 'DATABASE_ERROR'
      });
    }

    console.info(`Chat deleted: chatId=${chatId}, userId=${userId}`);
    res.json({ message: 'Chat deleted successfully' });
  } catch (err) {
    console.error(`Delete chat error: ${err.message}`);
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
      return res.status(400).json({ error: 'Invalid message ID format', code: 'INVALID_MESSAGE_ID' });
    }

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('chat_id')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      console.warn(`Message not found: messageId=${messageId}`);
      return res.status(404).json({ error: 'Message not found', code: 'MESSAGE_NOT_FOUND' });
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', message.chat_id)
      .eq('user_id', userId)
      .single();

    if (chatError || !chat) {
      console.warn(`Chat not found or unauthorized: chatId=${message.chat_id}, userId=${userId}`);
      return res.status(404).json({ error: 'Chat not found or unauthorized', code: 'CHAT_NOT_FOUND' });
    }

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (deleteError) {
      console.error(`Delete message error: ${deleteError.message}`);
      return res.status(500).json({ error: 'Failed to delete message', code: 'DATABASE_ERROR' });
    }

    const { data: lastMessage, error: lastMessageError } = await supabase
      .from('messages')
      .select('content')
      .eq('chat_id', message.chat_id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

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
    console.error(`Delete message error: ${err.message}`);
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
  console.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Graceful shutdown
const server = app.listen(process.env.PORT || 3001, () => {
  console.info(`Server started on port ${process.env.PORT || 3001}`);
});

process.on('SIGTERM', () => {
  console.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
