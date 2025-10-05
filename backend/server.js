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

// AI Model configurations with priorities
const AI_MODELS = {
  // General chat models (fast & reliable)
  chat: [
    { id: 'deepseek/deepseek-chat-v3.1:free', priority: 1, timeout: 15000 },
    { id: 'google/gemini-2.0-flash-exp:free', priority: 2, timeout: 12000 },
    { id: 'meta-llama/llama-3.3-8b-instruct:free', priority: 3, timeout: 12000 },
    { id: 'z-ai/glm-4.5-air:free', priority: 4, timeout: 15000 },
    { id: 'qwen/qwen3-4b:free', priority: 5, timeout: 10000 },
    { id: 'openai/gpt-oss-20b:free', priority: 6, timeout: 15000 }
  ],
  // Reasoning models (for complex queries)
  reasoning: [
    { id: 'deepseek/deepseek-r1-0528:free', priority: 1, timeout: 20000 },
    { id: 'tngtech/deepseek-r1t2-chimera:free', priority: 2, timeout: 20000 }
  ],
  // Research model (for web search tasks)
  research: [
    { id: 'alibaba/tongyi-deepresearch-30b-a3b:free', priority: 1, timeout: 25000 }
  ],
  // Quick models (for prompt enhancement & decisions)
  quick: [
    { id: 'google/gemini-2.0-flash-exp:free', priority: 1, timeout: 8000 },
    { id: 'qwen/qwen3-4b:free', priority: 2, timeout: 8000 },
    { id: 'deepseek/deepseek-chat-v3.1:free', priority: 3, timeout: 10000 }
  ]
};

// Model performance tracking
const modelStats = new Map();

// Rate limit tracking per model
const rateLimitTracker = new Map();

function initModelStats() {
  for (const category in AI_MODELS) {
    AI_MODELS[category].forEach(model => {
      modelStats.set(model.id, {
        successCount: 0,
        failCount: 0,
        avgResponseTime: 0,
        lastUsed: null
      });
      
      rateLimitTracker.set(model.id, {
        isRateLimited: false,
        rateLimitUntil: null,
        consecutiveErrors: 0
      });
    });
  }
}

initModelStats();

// Check if model is currently rate limited
function isModelRateLimited(modelId) {
  const tracker = rateLimitTracker.get(modelId);
  if (!tracker || !tracker.isRateLimited) return false;
  
  if (tracker.rateLimitUntil && Date.now() < tracker.rateLimitUntil) {
    return true;
  }
  
  // Reset if time has passed
  tracker.isRateLimited = false;
  tracker.rateLimitUntil = null;
  tracker.consecutiveErrors = 0;
  rateLimitTracker.set(modelId, tracker);
  return false;
}

// Mark model as rate limited
function markModelRateLimited(modelId, retryAfterSeconds) {
  const tracker = rateLimitTracker.get(modelId) || {
    isRateLimited: false,
    rateLimitUntil: null,
    consecutiveErrors: 0
  };
  
  tracker.isRateLimited = true;
  tracker.rateLimitUntil = Date.now() + (retryAfterSeconds * 1000);
  tracker.consecutiveErrors++;
  
  rateLimitTracker.set(modelId, tracker);
  console.warn(`⚠️ Model ${modelId} rate limited until ${new Date(tracker.rateLimitUntil).toISOString()}`);
}

// Parse retry-after from error message
function parseRetryAfter(errorMessage) {
  const match = errorMessage.match(/try again (\d+) seconds later/i);
  if (match && match[1]) {
    return parseInt(match[1]);
  }
  return 60; // Default 60 seconds
}

// Serve static files
app.use(express.static(path.join(__dirname, 'test', 'frontend', 'dist'), {
  maxAge: '1d'
}));

app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://openrouter.ai", "https://image.pollinations.ai", "https://api.duckduckgo.com", "https://en.wikipedia.org", "https://vi.wikipedia.org", "https://searx.be", "https://search.brave.com", "https://api.qwant.com"],
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
    version: '3.0.0',
    endpoints: [
      '/health',
      '/api/register',
      '/api/login',
      '/api/chat',
      '/api/generate-image',
      '/api/chat/history',
      '/api/chat/:chatId',
      '/api/message/:messageId',
      '/api/model-stats'
    ],
    features: [
      '🚀 Multi-model parallel racing (9 AI models)',
      '🧠 Smart model selection & fallback',
      '⚡ Enhanced multi-source search (6 sources)',
      '🎯 Priority source ranking (20+ domains)',
      '⏱️ Optimized speed (<30s guaranteed)',
      '🤖 AI-enhanced prompts',
      '🔒 Secure with rate limiting'
    ],
    aiModels: {
      chat: AI_MODELS.chat.map(m => m.id),
      reasoning: AI_MODELS.reasoning.map(m => m.id),
      research: AI_MODELS.research.map(m => m.id),
      quick: AI_MODELS.quick.map(m => m.id)
    }
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

// Update model statistics
function updateModelStats(modelId, success, responseTime) {
  const stats = modelStats.get(modelId);
  if (!stats) return;
  
  if (success) {
    stats.successCount++;
    stats.avgResponseTime = stats.avgResponseTime === 0 
      ? responseTime 
      : (stats.avgResponseTime * 0.7 + responseTime * 0.3);
  } else {
    stats.failCount++;
  }
  
  stats.lastUsed = Date.now();
  modelStats.set(modelId, stats);
}

// Get sorted models by performance (excluding rate-limited ones)
function getSortedModels(category) {
  const models = AI_MODELS[category] || AI_MODELS.chat;
  
  // Filter out rate-limited models
  const availableModels = models.filter(model => !isModelRateLimited(model.id));
  
  if (availableModels.length === 0) {
    console.warn(`⚠️ All models in category ${category} are rate limited! Using all models anyway...`);
    return models; // Return all if none available (last resort)
  }
  
  return availableModels.sort((a, b) => {
    const statsA = modelStats.get(a.id) || { successCount: 0, failCount: 0, avgResponseTime: Infinity };
    const statsB = modelStats.get(b.id) || { successCount: 0, failCount: 0, avgResponseTime: Infinity };
    
    const scoreA = statsA.successCount / Math.max(1, statsA.successCount + statsA.failCount);
    const scoreB = statsB.successCount / Math.max(1, statsB.successCount + statsB.failCount);
    
    if (Math.abs(scoreA - scoreB) > 0.1) {
      return scoreB - scoreA;
    }
    
    return statsA.avgResponseTime - statsB.avgResponseTime;
  });
}

// ENHANCED: Parallel model racing with fallback and rate limit handling
async function callAIWithRacing(messages, category = 'chat', options = {}) {
  const models = getSortedModels(category);
  const { 
    temperature = 0.7, 
    maxTokens = 500,
    raceCount = 3,
    fallbackAll = false 
  } = options;
  
  console.log(`🏁 Starting AI race with ${Math.min(raceCount, models.length)} models from category: ${category}`);
  
  // First wave: Race top models (skip rate-limited ones)
  const availableRaceModels = models.slice(0, raceCount);
  
  if (availableRaceModels.length === 0) {
    throw new Error('No available models to race');
  }
  
  const racePromises = availableRaceModels.map(model => {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), model.timeout);
    
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hein1.onrender.com',
        'X-Title': 'Hein AI'
      },
      body: JSON.stringify({
        model: model.id,
        messages,
        temperature,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    })
    .then(async response => {
      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        
        // Check for rate limit error
        if (response.status === 429 || errorText.includes('rate limit') || errorText.includes('Rate limit')) {
          const retryAfter = parseRetryAfter(errorText);
          markModelRateLimited(model.id, retryAfter);
          updateModelStats(model.id, false, responseTime);
          throw new Error(`${model.id} rate limited (retry after ${retryAfter}s)`);
        }
        
        updateModelStats(model.id, false, responseTime);
        throw new Error(`${model.id} failed: ${response.status}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        updateModelStats(model.id, false, responseTime);
        throw new Error(`${model.id} returned empty response`);
      }
      
      updateModelStats(model.id, true, responseTime);
      console.log(`✓ ${model.id} responded in ${responseTime}ms`);
      
      return {
        content,
        modelId: model.id,
        responseTime,
        success: true
      };
    })
    .catch(error => {
      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;
      
      if (!error.message.includes('rate limited')) {
        updateModelStats(model.id, false, responseTime);
      }
      
      console.warn(`✗ ${model.id}: ${error.message}`);
      throw error;
    });
  });
  
  try {
    // Return first successful response
    const result = await Promise.race(racePromises);
    return result;
  } catch (error) {
    console.warn(`First wave failed: ${error.message}, trying fallback models...`);
    
    // Fallback: Try remaining models sequentially or all if requested
    const fallbackModels = models.slice(raceCount);
    
    if (fallbackAll && fallbackModels.length > 0) {
      // Try all remaining models in parallel
      const fallbackPromises = fallbackModels.map(async model => {
        // Skip if rate limited
        if (isModelRateLimited(model.id)) {
          throw new Error(`${model.id} is rate limited`);
        }
        
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), model.timeout);
        
        try {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://hein1.onrender.com',
              'X-Title': 'Hein AI'
            },
            body: JSON.stringify({
              model: model.id,
              messages,
              temperature,
              max_tokens: maxTokens
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeout);
          const responseTime = Date.now() - startTime;
          
          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            
            if (response.status === 429 || errorText.includes('rate limit') || errorText.includes('Rate limit')) {
              const retryAfter = parseRetryAfter(errorText);
              markModelRateLimited(model.id, retryAfter);
              updateModelStats(model.id, false, responseTime);
              throw new Error(`Rate limited (retry after ${retryAfter}s)`);
            }
            
            updateModelStats(model.id, false, responseTime);
            throw new Error(`Failed: ${response.status}`);
          }
          
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          
          if (!content) {
            updateModelStats(model.id, false, responseTime);
            throw new Error('Empty response');
          }
          
          updateModelStats(model.id, true, responseTime);
          console.log(`✓ Fallback ${model.id} responded in ${responseTime}ms`);
          
          return {
            content,
            modelId: model.id,
            responseTime,
            success: true
          };
        } catch (err) {
          clearTimeout(timeout);
          throw err;
        }
      });
      
      return await Promise.race(fallbackPromises);
    } else {
      // Try remaining models one by one
      for (const model of fallbackModels) {
        // Skip if rate limited
        if (isModelRateLimited(model.id)) {
          console.warn(`⏭️ Skipping ${model.id} (rate limited)`);
          continue;
        }
        
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), model.timeout);
        
        try {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://hein1.onrender.com',
              'X-Title': 'Hein AI'
            },
            body: JSON.stringify({
              model: model.id,
              messages,
              temperature,
              max_tokens: maxTokens
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeout);
          const responseTime = Date.now() - startTime;
          
          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            
            if (response.status === 429 || errorText.includes('rate limit') || errorText.includes('Rate limit')) {
              const retryAfter = parseRetryAfter(errorText);
              markModelRateLimited(model.id, retryAfter);
              updateModelStats(model.id, false, responseTime);
              console.warn(`⚠️ ${model.id} rate limited, trying next model...`);
              continue;
            }
            
            updateModelStats(model.id, false, responseTime);
            continue;
          }
          
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          
          if (!content) {
            updateModelStats(model.id, false, responseTime);
            continue;
          }
          
          updateModelStats(model.id, true, responseTime);
          console.log(`✓ Fallback ${model.id} responded in ${responseTime}ms`);
          
          return {
            content,
            modelId: model.id,
            responseTime,
            success: true
          };
        } catch (err) {
          clearTimeout(timeout);
          console.warn(`✗ Fallback ${model.id}: ${err.message}`);
          continue;
        }
      }
    }
    
    throw new Error('All AI models failed or are rate limited');
  }
}

// Enhance prompt using AI with sequential testing
async function enhancePrompt(userPrompt, isImagePrompt = false) {
  try {
    console.log(`Starting prompt enhancement for: "${userPrompt}" (Image: ${isImagePrompt})`);
    
    const systemMessage = isImagePrompt
      ? 'You are a photo editing assistant. Translate the user\'s image request into English (if it isn\'t already) and edit it with artistic details to create a beautiful image. Keep the photo editing prompt under 70 characters. Focus on: style, lighting, composition. ABSOLUTELY no periods or commas. ONLY return the photo editing prompt, nothing else.'
      : 'You are a conversational AI assistant. Enhance the user\'s prompt to make it clearer and more detailed for better AI responses, while preserving the original intent. Keep the enhanced prompt under 200 characters. Return only the enhanced prompt, nothing else.';
    
    const enhanceMessages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: `Enhance this prompt: "${userPrompt}"` }
    ];

    const result = await callAISequential(enhanceMessages, 'quick', {
      temperature: 0.7,
      maxTokens: isImagePrompt ? 100 : 200
    });
    
    const enhancedPrompt = result.content.trim() || userPrompt;
    const maxLength = isImagePrompt ? 200 : 500;
    const finalPrompt = enhancedPrompt.length > maxLength 
      ? enhancedPrompt.substring(0, maxLength - 3) + '...' 
      : enhancedPrompt;
    
    console.log(`Prompt enhanced by ${result.modelId}: "${finalPrompt}"`);
    return finalPrompt;
  } catch (error) {
    console.warn(`Prompt enhancement failed: ${error.message}, using original`);
    return userPrompt;
  }
}

// AI-powered decision: Should we search the web?
async function shouldSearchWeb(userMessage) {
  try {
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

    const result = await callAISequential(decisionPrompt, 'quick', {
      temperature: 0.1,
      maxTokens: 10
    });
    
    const decision = result.content.trim().toUpperCase();
    console.log(`🤖 AI Search decision (${result.modelId}): ${decision} for: "${userMessage}"`);
    return decision === 'YES';
  } catch (error) {
    console.warn(`Search decision error: ${error.message}, defaulting to NO`);
    return false;
  }
}

// ENHANCED: Multi-source web search (6 sources, no API keys)
async function searchWithPrioritySources(query, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`🔍 Starting enhanced multi-source web search for: "${query}"`);
    const startTime = Date.now();
    
    const encodedQuery = encodeURIComponent(query);
    const results = [];
    
    // Priority domains for ranking
    const priorityDomains = [
      'wikipedia.org', 'britannica.com', 'scholarpedia.org',
      'vnexpress.net', 'thanhnien.vn', 'tuoitre.vn', 'dantri.com.vn', 'vietnamnet.vn',
      'bbc.com', 'reuters.com', 'nytimes.com', 'cnn.com', 'theguardian.com', 'apnews.com',
      'stackoverflow.com', 'github.com', 'medium.com', 'dev.to', 'hackernews.com',
      'arxiv.org', 'scholar.google.com', 'nature.com', 'sciencedirect.com', 'researchgate.net',
      'reddit.com', 'quora.com', 'stackexchange.com'
    ];
    
    // Search 1: DuckDuckGo API
    const duckDuckGoSearch = async () => {
      try {
        const searchUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
        const response = await fetch(searchUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
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
          for (const topic of data.RelatedTopics.slice(0, 8)) {
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
              } catch (urlError) {}
            }
          }
        }
        
        console.log(`✓ DuckDuckGo: Found ${ddgResults.length} results`);
        return ddgResults;
      } catch (error) {
        console.warn(`✗ DuckDuckGo search failed: ${error.message}`);
        return [];
      }
    };

    // Search 2: Wikipedia (English)
    const wikipediaSearch = async () => {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&srlimit=5&origin=*`;
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
              priority: 9
            });
          }
        }
        
        console.log(`✓ Wikipedia (EN): Found ${wikiResults.length} results`);
        return wikiResults;
      } catch (error) {
        console.warn(`✗ Wikipedia search failed: ${error.message}`);
        return [];
      }
    };

    // Search 3: Vietnamese Wikipedia
    const wikipediaViSearch = async () => {
      try {
        const wikiUrl = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&srlimit=3&origin=*`;
        const response = await fetch(wikiUrl, { signal: controller.signal });
        
        if (!response.ok) return [];
        
        const data = await response.json();
        const wikiResults = [];
        
        if (data.query && data.query.search) {
          for (const item of data.query.search) {
            wikiResults.push({
              title: item.title,
              snippet: item.snippet.replace(/<[^>]*>/g, ''),
              link: `https://vi.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
              source: 'vi.wikipedia.org',
              priority: 9
            });
          }
        }
        
        console.log(`✓ Wikipedia (VI): Found ${wikiResults.length} results`);
        return wikiResults;
      } catch (error) {
        console.warn(`✗ Vietnamese Wikipedia search failed: ${error.message}`);
        return [];
      }
    };

    // Search 4: SearXNG (Meta-search engine)
    const searxSearch = async () => {
      try {
        const searxUrl = `https://searx.be/search?q=${encodedQuery}&format=json&language=all&categories=general`;
        const response = await fetch(searxUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });

        if (!response.ok) return [];

        const data = await response.json();
        const searxResults = [];
        
        if (data.results && Array.isArray(data.results)) {
          for (const item of data.results.slice(0, 6)) {
            try {
              const url = new URL(item.url);
              const domain = url.hostname;
              const isPriority = priorityDomains.some(pd => domain.includes(pd));
              
              searxResults.push({
                title: item.title || 'No title',
                snippet: item.content || item.title || '',
                link: item.url,
                source: domain,
                priority: isPriority ? 6 : 2
              });
            } catch (urlError) {}
          }
        }
        
        console.log(`✓ SearXNG: Found ${searxResults.length} results`);
        return searxResults;
      } catch (error) {
        console.warn(`✗ SearXNG search failed: ${error.message}`);
        return [];
      }
    };

    // Search 5: Brave Search
    const braveSearch = async () => {
      try {
        const braveUrl = `https://search.brave.com/search?q=${encodedQuery}&source=web`;
        const response = await fetch(braveUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://search.brave.com/'
          },
          signal: controller.signal
        });

        if (!response.ok) return [];

        const html = await response.text();
        const braveResults = [];
        
        const resultPattern = /<div[^>]*class="[^"]*snippet[^"]*"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<p[^>]*class="[^"]*snippet-description[^"]*"[^>]*>(.*?)<\/p>/gs;
        
        let match;
        let count = 0;
        
        while ((match = resultPattern.exec(html)) !== null && count < 5) {
          try {
            const link = match[1];
            const title = match[2].replace(/<[^>]*>/g, '').trim();
            const snippet = match[3].replace(/<[^>]*>/g, '').trim();
            
            if (link && title) {
              const url = new URL(link);
              const domain = url.hostname;
              const isPriority = priorityDomains.some(pd => domain.includes(pd));
              
              braveResults.push({
                title: title,
                snippet: snippet || title,
                link: link,
                source: domain,
                priority: isPriority ? 7 : 3
              });
              count++;
            }
          } catch (urlError) {}
        }
        
        console.log(`✓ Brave: Found ${braveResults.length} results`);
        return braveResults;
      } catch (error) {
        console.warn(`✗ Brave search failed: ${error.message}`);
        return [];
      }
    };

    // Search 6: Qwant
    const qwantSearch = async () => {
      try {
        const qwantUrl = `https://api.qwant.com/v3/search/web?q=${encodedQuery}&count=5&locale=en_US&device=desktop&safesearch=1`;
        const response = await fetch(qwantUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });

        if (!response.ok) return [];

        const data = await response.json();
        const qwantResults = [];
        
        if (data.data?.result?.items?.mainline) {
          for (const section of data.data.result.items.mainline) {
            if (section.type === 'web' && section.items) {
              for (const item of section.items.slice(0, 5)) {
                try {
                  const url = new URL(item.url);
                  const domain = url.hostname;
                  const isPriority = priorityDomains.some(pd => domain.includes(pd));
                  
                  qwantResults.push({
                    title: item.title || 'No title',
                    snippet: item.desc || item.title || '',
                    link: item.url,
                    source: domain,
                    priority: isPriority ? 5 : 2
                  });
                } catch (urlError) {}
              }
            }
          }
        }
        
        console.log(`✓ Qwant: Found ${qwantResults.length} results`);
        return qwantResults;
      } catch (error) {
        console.warn(`✗ Qwant search failed: ${error.message}`);
        return [];
      }
    };

    // Execute all searches in parallel
    const searchPromises = [
      Promise.race([duckDuckGoSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('DDG timeout')), 10000))]),
      Promise.race([wikipediaSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('Wiki EN timeout')), 10000))]),
      Promise.race([wikipediaViSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('Wiki VI timeout')), 10000))]),
      Promise.race([searxSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('SearXNG timeout')), 10000))]),
      Promise.race([braveSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('Brave timeout')), 12000))]),
      Promise.race([qwantSearch(), new Promise((_, rej) => setTimeout(() => rej(new Error('Qwant timeout')), 10000))])
    ];

    const settledResults = await Promise.allSettled(searchPromises);

    // Combine results
    settledResults.forEach((result, index) => {
      const sourceName = ['DuckDuckGo', 'Wikipedia (EN)', 'Wikipedia (VI)', 'SearXNG', 'Brave', 'Qwant'][index];
      if (result.status === 'fulfilled' && result.value && Array.isArray(result.value)) {
        results.push(...result.value);
      } else {
        console.warn(`${sourceName}: ${result.status === 'rejected' ? result.reason.message : 'No results'}`);
      }
    });

    // Deduplicate and sort
    const uniqueResults = Array.from(
      new Map(results.map(r => [r.link, r])).values()
    );
    
    uniqueResults.sort((a, b) => b.priority - a.priority);
    const topResults = uniqueResults.slice(0, 12);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Multi-source search completed in ${elapsed}s, found ${topResults.length} unique results from ${results.length} total`);
    
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

// Enhanced AI summarization with research model (sequential)
async function summarizeSearchResults(query, searchResults, timeoutMs = 8000) {
  if (!searchResults || searchResults.length === 0) {
    return 'Không tìm thấy kết quả phù hợp. Vui lòng thử lại với từ khóa khác.';
  }
  
  try {
    console.log(`🤖 Starting AI summarization for ${searchResults.length} results...`);
    const startTime = Date.now();
    
    const formattedResults = searchResults
      .slice(0, 8)
      .map((r, i) => `[${i + 1}] ${r.title}\nSource: ${r.source}\nInfo: ${r.snippet.substring(0, 250)}`)
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

    // Use research model first, then fallback to chat models
    let result;
    try {
      result = await callAISequential(summaryMessages, 'research', {
        temperature: 0.2,
        maxTokens: 350
      });
    } catch (error) {
      console.warn('Research model failed, falling back to chat models');
      result = await callAISequential(summaryMessages, 'chat', {
        temperature: 0.2,
        maxTokens: 350
      });
    }
    
    let summary = result.content.trim() || 'Không thể tạo tóm tắt từ kết quả tìm kiếm.';
    summary = summary.replace(/\*\*/g, '');
    
    const sourcesSection = '\n\n---\n**📚 Nguồn:**\n' + 
      searchResults
        .slice(0, 8)
        .map((r, i) => `[${i + 1}] [${r.source}](${r.link})`)
        .join(' • ');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Summarization by ${result.modelId} completed in ${elapsed}s`);
    
    return summary + sourcesSection;
    
  } catch (error) {
    console.error(`Summarization error: ${error.message}`);
    return 'Không thể tạo tóm tắt. Vui lòng thử lại.';
  }
}
        .join(' • ');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Summarization by ${result.modelId} completed in ${elapsed}s`);
    
    return summary + sourcesSection;
    
  } catch (error) {
    console.error(`Summarization error: ${error.message}`);
    return 'Không thể tạo tóm tắt. Vui lòng thử lại.';
  }
}
        .join(' • ');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Summarization by ${result.modelId} completed in ${elapsed}s`);
    
    return summary + sourcesSection;
    
  } catch (error) {
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
      version: '3.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dependencies: { 
        supabase: 'connected', 
        openRouter: 'connected', 
        webSearch: 'enabled (6 sources)',
        aiModels: `${AI_MODELS.chat.length + AI_MODELS.reasoning.length + AI_MODELS.research.length} models available`
      }
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

// Model stats endpoint
app.get('/api/model-stats', (req, res) => {
  const stats = {};
  const categories = {};
  
  for (const [modelId, data] of modelStats.entries()) {
    const total = data.successCount + data.failCount;
    const rateLimitInfo = rateLimitTracker.get(modelId);
    
    stats[modelId] = {
      successRate: total > 0 ? ((data.successCount / total) * 100).toFixed(1) + '%' : 'N/A',
      avgResponseTime: data.avgResponseTime > 0 ? data.avgResponseTime.toFixed(0) + 'ms' : 'N/A',
      totalCalls: total,
      successCalls: data.successCount,
      failCalls: data.failCount,
      lastUsed: data.lastUsed ? new Date(data.lastUsed).toISOString() : 'Never',
      isRateLimited: rateLimitInfo?.isRateLimited || false,
      rateLimitUntil: rateLimitInfo?.rateLimitUntil ? new Date(rateLimitInfo.rateLimitUntil).toISOString() : null
    };
  }
  
  // Show sorted order for each category
  for (const [category, models] of Object.entries(AI_MODELS)) {
    const sorted = getSortedModels(category);
    categories[category] = sorted.map(m => ({
      id: m.id,
      position: sorted.indexOf(m) + 1,
      avgResponseTime: modelStats.get(m.id)?.avgResponseTime?.toFixed(0) + 'ms' || 'N/A',
      successRate: stats[m.id]?.successRate || 'N/A',
      isRateLimited: stats[m.id]?.isRateLimited || false
    }));
  }
  
  res.json({
    modelStats: stats,
    sortedCategories: categories,
    info: 'Models are automatically sorted by performance (success rate + speed). Fastest & most reliable models appear first.'
  });
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

// Chat endpoint with smart auto web search and multi-model racing
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
    let searchSourcesUsed = [];
    let usedModel = '';
    
    // Check for explicit search keywords OR use AI decision
    const searchKeywords = ['tìm kiếm web:', 'web search:', 'search:', 'tìm:', 'tra cứu:', 'search web:', 'google:', 'bing:'];
    const hasSearchKeyword = searchKeywords.some(keyword => 
      userContent.toLowerCase().startsWith(keyword.toLowerCase())
    );
    
    let shouldSearch = hasSearchKeyword;
    
    // If no explicit keyword, let AI decide
    if (!hasSearchKeyword) {
      console.log(`No search keyword detected, asking AI for decision...`);
      shouldSearch = await shouldSearchWeb(userContent);
    }

    if (shouldSearch) {
      wasWebSearch = true;
      console.log(`Executing enhanced web search (${hasSearchKeyword ? 'keyword' : 'AI decision'})...`);
      
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
      
      // Execute enhanced multi-source search
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
        searchSourcesUsed = [...new Set(searchResults.map(r => r.source))].slice(0, 5);
        console.log(`Found ${searchResults.length} results from sources: ${searchSourcesUsed.join(', ')}`);
        
        const summaryResult = await summarizeSearchResults(searchQuery, searchResults, 8000);
        aiMessage = summaryResult;
        usedModel = 'research-model';
      } else {
        aiMessage = hasSearchKeyword 
          ? 'Không tìm thấy kết quả phù hợp. Vui lòng thử lại với từ khóa khác.'
          : 'Xin lỗi, tôi không tìm thấy thông tin liên quan. Bạn có thể hỏi câu khác không?';
      }
      
    } else {
      // Regular AI chat (no search) with sequential model testing
      console.log(`Processing as regular chat (no search needed)`);
      
      if (prompt) {
        const enhancedResult = await enhancePrompt(userContent, false);
        if (enhancedResult !== userContent) {
          finalPrompt = enhancedResult;
          enhancedPromptUsed = true;
        }
      }

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

      try {
        const result = await callAISequential(messagesWithSystem, 'chat', {
          temperature: 0.7,
          maxTokens: 500
        });
        
        aiMessage = result.content;
        usedModel = result.modelId;
        
        if (enhancedPromptUsed) {
          aiMessage = `${aiMessage}\n\n*Enhanced prompt: ${finalPrompt}*`;
        }
      } catch (error) {
        console.error(`AI request failed: ${error.message}`);
        return res.status(500).json({ error: 'All AI models failed', code: 'AI_SERVICE_ERROR' });
      }
    }

    const totalElapsed = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    
    if (wasWebSearch) {
      aiMessage += `\n\n*⏱️ Total: ${totalElapsed}s | Sources: ${searchSourcesUsed.length}*`;
    } else {
      const modelStats = getSortedModels('chat').map(m => {
        const stats = modelStats.get(m.id);
        if (!stats || stats.successCount === 0) return null;
        return `${m.id.split('/')[1]}: ${stats.avgResponseTime.toFixed(0)}ms`;
      }).filter(Boolean).slice(0, 3);
      
      aiMessage += `\n\n*🤖 Model: ${usedModel} | ⏱️ ${totalElapsed}s*`;
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

    console.info(`Chat message processed: chatId=${newChatId}, model=${usedModel}, webSearch=${wasWebSearch}, time=${totalElapsed}s`);
    res.json({
      message: aiMessage,
      messageId: savedMessage.id,
      chatId: newChatId,
      timestamp: savedMessage.timestamp,
      enhancedPrompt: enhancedPromptUsed ? finalPrompt : undefined,
      originalPrompt: enhancedPromptUsed ? userContent : undefined,
      isWebSearch: wasWebSearch,
      searchTime: wasWebSearch ? `${totalElapsed}s` : undefined,
      searchSources: wasWebSearch ? searchSourcesUsed : undefined,
      usedModel: usedModel
    });
  } catch (err) {
    console.error(`Chat endpoint error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Generate image endpoint with multi-model racing
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

    console.log(`Enhancing prompt with AI...`);
    const startTime = Date.now();
    
    const enhancedPrompt = await enhancePrompt(sanitizedPrompt, true);
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;

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
        .createSignedUrl(`public/${imageId}.png`, 60 * 60 * 24);
      finalImageUrl = signedUrlData?.signedUrl || imageUrl;
    }

    console.log(`Starting smart polling verification...`);
    const verificationResult = await verifyImageWithPolling(finalImageUrl);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (!verificationResult.success) {
      console.warn(`Image verification failed, returning unverified URL`);
    }

    console.log(`${verificationResult.success ? '✓' : '✗'} Image process completed in ${totalTime}s`);

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
  console.info(`========================================`);
  console.info(`🚀 Server started on port ${process.env.PORT || 3001}`);
  console.info(`========================================`);
  console.info(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.info(`CORS origins: ${allowedOrigins.join(', ')}`);
  console.info(`\n🤖 Self-Learning AI System: ENABLED`);
  console.info(`   ├─ Chat models: ${AI_MODELS.chat.length} (sequential testing)`);
  console.info(`   ├─ Reasoning models: ${AI_MODELS.reasoning.length}`);
  console.info(`   ├─ Research model: ${AI_MODELS.research.length} (web search)`);
  console.info(`   └─ Quick models: ${AI_MODELS.quick.length} (decisions & prompts)`);
  console.info(`\n⚡ Performance Features:`);
  console.info(`   └─ Sequential model testing (one-by-one)`);
  console.info(`   └─ Auto-learning: tracks speed & success rate`);
  console.info(`   └─ Smart sorting: fastest models first`);
  console.info(`   └─ Rate limit protection & auto-skip`);
  console.info(`\n🔍 Enhanced Multi-Source Web Search: ENABLED`);
  console.info(`   └─ Sources: DuckDuckGo, Wikipedia (EN/VI), SearXNG, Brave, Qwant`);
  console.info(`   └─ Priority domains: 20+ sources tracked`);
  console.info(`   └─ Search timeout: <30s guaranteed`);
  console.info(`\n🔒 Security:`);
  console.info(`   └─ Rate limiting enabled`);
  console.info(`   └─ Helmet security headers`);
  console.info(`   └─ Input sanitization`);
  console.info(`\n📊 Monitor performance at: GET /api/model-stats`);
  console.info(`\nVersion: 3.0.0 - Self-Learning Sequential Edition`);
  console.info(`========================================\n`);
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
