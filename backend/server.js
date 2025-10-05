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

// AI Model configurations - OPTIMIZED for speed
const AI_MODELS = {
  chat: [
    { id: 'google/gemini-2.0-flash-exp:free', priority: 1, timeout: 8000 },
    { id: 'qwen/qwen3-4b:free', priority: 2, timeout: 8000 },
    { id: 'deepseek/deepseek-chat-v3.1:free', priority: 3, timeout: 12000 },
    { id: 'meta-llama/llama-3.3-8b-instruct:free', priority: 4, timeout: 12000 },
  ],
  quick: [
    { id: 'qwen/qwen3-4b:free', priority: 1, timeout: 6000 },
    { id: 'google/gemini-2.0-flash-exp:free', priority: 2, timeout: 7000 },
  ],
  research: [
    { id: 'alibaba/tongyi-deepresearch-30b-a3b:free', priority: 1, timeout: 20000 }
  ]
};

// Model performance tracking
const modelStats = new Map();
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

// Check if model is rate limited
function isModelRateLimited(modelId) {
  const tracker = rateLimitTracker.get(modelId);
  if (!tracker || !tracker.isRateLimited) return false;
  
  if (tracker.rateLimitUntil && Date.now() < tracker.rateLimitUntil) {
    return true;
  }
  
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

// Parse retry-after from error
function parseRetryAfter(errorMessage) {
  const match = errorMessage.match(/try again (\d+) seconds later/i);
  return match && match[1] ? parseInt(match[1]) : 60;
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

// Get sorted models by performance
function getSortedModels(category) {
  const models = AI_MODELS[category] || AI_MODELS.chat;
  const availableModels = models.filter(model => !isModelRateLimited(model.id));
  
  if (availableModels.length === 0) {
    console.warn(`⚠️ All models in ${category} rate limited, using all anyway`);
    return models;
  }
  
  return availableModels.sort((a, b) => {
    const statsA = modelStats.get(a.id) || { successCount: 0, failCount: 0, avgResponseTime: Infinity };
    const statsB = modelStats.get(b.id) || { successCount: 0, failCount: 0, avgResponseTime: Infinity };
    
    const scoreA = statsA.successCount / Math.max(1, statsA.successCount + statsA.failCount);
    const scoreB = statsB.successCount / Math.max(1, statsB.successCount + statsB.failCount);
    
    if (Math.abs(scoreA - scoreB) > 0.1) return scoreB - scoreA;
    return statsA.avgResponseTime - statsB.avgResponseTime;
  });
}

// FIXED: Sequential AI call with proper error handling
async function callAISequential(messages, category = 'chat', options = {}) {
  const models = getSortedModels(category);
  const { temperature = 0.7, maxTokens = 500 } = options;
  
  console.log(`🔄 Sequential AI call: trying ${models.length} models from ${category}`);
  
  for (const model of models) {
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
        
        if (response.status === 429 || errorText.includes('rate limit')) {
          const retryAfter = parseRetryAfter(errorText);
          markModelRateLimited(model.id, retryAfter);
          updateModelStats(model.id, false, responseTime);
          console.warn(`⚠️ ${model.id} rate limited, trying next...`);
          continue;
        }
        
        updateModelStats(model.id, false, responseTime);
        console.warn(`✗ ${model.id} failed: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        updateModelStats(model.id, false, responseTime);
        console.warn(`✗ ${model.id} returned empty response`);
        continue;
      }
      
      updateModelStats(model.id, true, responseTime);
      console.log(`✓ ${model.id} succeeded in ${responseTime}ms`);
      
      return {
        content,
        modelId: model.id,
        responseTime,
        success: true
      };
    } catch (error) {
      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;
      
      if (error.name !== 'AbortError' && !error.message.includes('rate limited')) {
        updateModelStats(model.id, false, responseTime);
      }
      
      console.warn(`✗ ${model.id}: ${error.message}`);
      continue;
    }
  }
  
  throw new Error('All AI models failed or are rate limited');
}

// OPTIMIZED: Parallel racing for faster response (2 models max)
async function callAIRacing(messages, category = 'chat', options = {}) {
  const models = getSortedModels(category);
  const { temperature = 0.7, maxTokens = 500 } = options;
  
  // Race only top 2 fastest models
  const raceModels = models.slice(0, 2);
  console.log(`🏁 Racing ${raceModels.length} models: ${raceModels.map(m => m.id).join(', ')}`);
  
  const racePromises = raceModels.map(async model => {
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
        
        if (response.status === 429 || errorText.includes('rate limit')) {
          const retryAfter = parseRetryAfter(errorText);
          markModelRateLimited(model.id, retryAfter);
        }
        
        updateModelStats(model.id, false, responseTime);
        throw new Error(`${model.id} failed: ${response.status}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        updateModelStats(model.id, false, responseTime);
        throw new Error(`${model.id} empty response`);
      }
      
      updateModelStats(model.id, true, responseTime);
      console.log(`✓ ${model.id} won in ${responseTime}ms`);
      
      return { content, modelId: model.id, responseTime, success: true };
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  });
  
  try {
    return await Promise.race(racePromises);
  } catch (error) {
    // Fallback to sequential
    console.warn('Racing failed, falling back to sequential');
    return await callAISequential(messages, category, options);
  }
}

// Enhance prompt
async function enhancePrompt(userPrompt, isImagePrompt = false) {
  try {
    const systemMessage = isImagePrompt
      ? 'Translate to English and add artistic details. Max 70 chars, no punctuation. Return only the prompt.'
      : 'Enhance this prompt to be clearer. Max 200 chars. Return only enhanced prompt.';
    
    const result = await callAISequential([
      { role: 'system', content: systemMessage },
      { role: 'user', content: `Enhance: "${userPrompt}"` }
    ], 'quick', { temperature: 0.7, maxTokens: isImagePrompt ? 100 : 200 });
    
    const enhanced = result.content.trim() || userPrompt;
    const maxLen = isImagePrompt ? 200 : 500;
    return enhanced.length > maxLen ? enhanced.substring(0, maxLen - 3) + '...' : enhanced;
  } catch (error) {
    console.warn(`Prompt enhancement failed: ${error.message}`);
    return userPrompt;
  }
}

// AI decision: search web?
async function shouldSearchWeb(userMessage) {
  try {
    const result = await callAISequential([
      {
        role: 'system',
        content: 'Analyze if query needs web search. Reply ONLY "YES" or "NO". YES for: current events, news, real-time data, recent updates. NO for: general knowledge, coding, creative writing.'
      },
      { role: 'user', content: `Search needed for: "${userMessage}"` }
    ], 'quick', { temperature: 0.1, maxTokens: 10 });
    
    const decision = result.content.trim().toUpperCase();
    console.log(`🤖 Search decision: ${decision}`);
    return decision === 'YES';
  } catch (error) {
    console.warn(`Search decision failed: ${error.message}`);
    return false;
  }
}

// OPTIMIZED: Multi-source search with timeout
async function searchWithPrioritySources(query, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`🔍 Searching: "${query}"`);
    const startTime = Date.now();
    const encodedQuery = encodeURIComponent(query);
    
    const priorityDomains = [
      'wikipedia.org', 'britannica.com',
      'vnexpress.net', 'thanhnien.vn', 'tuoitre.vn',
      'bbc.com', 'reuters.com', 'cnn.com',
      'stackoverflow.com', 'github.com',
    ];
    
    // Fast searches only
    const searches = [
      // DuckDuckGo
      fetch(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }).then(r => r.json()).then(data => {
        const results = [];
        if (data.Abstract) {
          results.push({
            title: data.Heading || 'Answer',
            snippet: data.Abstract,
            link: data.AbstractURL || '',
            source: 'DuckDuckGo',
            priority: 10
          });
        }
        if (data.RelatedTopics) {
          data.RelatedTopics.slice(0, 5).forEach(t => {
            if (t.Text && t.FirstURL) {
              const domain = new URL(t.FirstURL).hostname;
              results.push({
                title: t.Text.split(' - ')[0],
                snippet: t.Text,
                link: t.FirstURL,
                source: domain,
                priority: priorityDomains.some(pd => domain.includes(pd)) ? 5 : 1
              });
            }
          });
        }
        return results;
      }).catch(() => []),
      
      // Wikipedia EN
      fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&srlimit=3&origin=*`, {
        signal: controller.signal
      }).then(r => r.json()).then(data => {
        return (data.query?.search || []).map(item => ({
          title: item.title,
          snippet: item.snippet.replace(/<[^>]*>/g, ''),
          link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
          source: 'wikipedia.org',
          priority: 9
        }));
      }).catch(() => [])
    ];

    const settledResults = await Promise.allSettled(searches.map(p => 
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))])
    ));

    const results = settledResults
      .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
      .flatMap(r => r.value);

    const uniqueResults = Array.from(new Map(results.map(r => [r.link, r])).values());
    uniqueResults.sort((a, b) => b.priority - a.priority);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Found ${uniqueResults.length} results in ${elapsed}s`);
    
    clearTimeout(timeout);
    return uniqueResults.slice(0, 8);
  } catch (error) {
    clearTimeout(timeout);
    console.error(`Search error: ${error.message}`);
    return [];
  }
}

// Summarize search results
async function summarizeSearchResults(query, searchResults) {
  if (!searchResults || searchResults.length === 0) {
    return 'Không tìm thấy kết quả. Vui lòng thử lại.';
  }
  
  try {
    const formattedResults = searchResults
      .slice(0, 6)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet.substring(0, 200)}`)
      .join('\n\n');
    
    const isVN = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệ]/i.test(query);
    
    const result = await callAISequential([
      {
        role: 'system',
        content: `Synthesize search results. Language: ${isVN ? 'Vietnamese' : 'English'}. Format: 2-3 sentence answer, then 3-4 bullet points. Cite sources [1], [2]. Max 200 words.`
      },
      { role: 'user', content: `Query: "${query}"\n\nResults:\n${formattedResults}` }
    ], 'research', { temperature: 0.2, maxTokens: 350 });
    
    const summary = result.content.trim().replace(/\*\*/g, '');
    const sources = '\n\n---\n**📚 Nguồn:**\n' + 
      searchResults.slice(0, 6).map((r, i) => `[${i + 1}] [${r.source}](${r.link})`).join(' • ');
    
    return summary + sources;
  } catch (error) {
    console.error(`Summarization error: ${error.message}`);
    return 'Không thể tạo tóm tắt.';
  }
}

// Optimized image verification
async function verifyImageWithPolling(imageUrl) {
  console.log('Verifying image...');
  await new Promise(r => setTimeout(r, 2000));
  
  for (let i = 1; i <= 3; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(imageUrl, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
        console.log(`✓ Image verified on attempt ${i}`);
        return { success: true, attempts: i };
      }
    } catch (error) {
      console.warn(`Attempt ${i} failed: ${error.message}`);
    }
    
    if (i < 3) await new Promise(r => setTimeout(r, 800));
  }
  
  return { success: false, attempts: 3 };
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://openrouter.ai", "https://image.pollinations.ai", "https://api.duckduckgo.com", "https://en.wikipedia.org"],
    }
  }
}));

app.set('trust proxy', 1);

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many auth attempts' },
  skipSuccessfulRequests: true
});

const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many image requests' }
});

// CORS
const allowedOrigins = [
  'https://hein1.onrender.com',
  'https://test-d9o3.onrender.com',
  ...(process.env.NODE_ENV === 'development' ? [
    'http://localhost:3000',
    'http://localhost:5173'
  ] : [])
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      const { data: chat } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chatId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!chat) return res.status(404).json({ error: 'Chat not found' });
      newChatId = chat.id;
    }

    const userContent = prompt ? sanitizeInput(prompt) : sanitizeInput(messages.filter(m => m.role === 'user').pop()?.content || '');
    if (!userContent) return res.status(400).json({ error: 'No message' });

    // Save user message
    await supabase.from('messages').insert([{
      chat_id: newChatId,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString()
    }]);

    const startTime = Date.now();
    let aiMessage = '';
    let usedModel = '';
    let wasWebSearch = false;
    let searchSources = [];

    // Check if web search needed
    const searchKeywords = ['tìm kiếm:', 'search:', 'tra cứu:'];
    const hasKeyword = searchKeywords.some(k => userContent.toLowerCase().startsWith(k.toLowerCase()));
    
    let shouldSearch = hasKeyword || await shouldSearchWeb(userContent);

    if (shouldSearch) {
      wasWebSearch = true;
      let query = userContent;
      
      if (hasKeyword) {
        for (const k of searchKeywords) {
          if (userContent.toLowerCase().startsWith(k.toLowerCase())) {
            query = userContent.substring(k.length).trim();
            break;
          }
        }
      }

      const searchResults = await searchWithPrioritySources(query, 20000).catch(() => []);
      
      if (searchResults.length > 0) {
        searchSources = [...new Set(searchResults.map(r => r.source))].slice(0, 5);
        aiMessage = await summarizeSearchResults(query, searchResults);
        usedModel = 'research';
      } else {
        aiMessage = 'Không tìm thấy kết quả. Vui lòng thử lại.';
      }
    } else {
      // Regular chat - use racing for speed
      const mappedMessages = messages.map(m => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: sanitizeInput(m.content)
      }));

      const systemMsg = {
        role: 'system',
        content: 'You are Hein, an AI by Hien2309. Answer in user\'s language. Be accurate, concise, practical. No fabrication.'
      };

      try {
        const result = await callAIRacing([systemMsg, ...mappedMessages], 'chat', {
          temperature: 0.7,
          maxTokens: 500
        });
        
        aiMessage = result.content;
        usedModel = result.modelId;
      } catch (error) {
        console.error(`AI failed: ${error.message}`);
        return res.status(500).json({ error: 'AI unavailable', code: 'AI_ERROR' });
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (wasWebSearch) {
      aiMessage += `\n\n*⏱️ ${elapsed}s | Sources: ${searchSources.length}*`;
    } else {
      aiMessage += `\n\n*🤖 ${usedModel.split('/')[1]} | ⏱️ ${elapsed}s*`;
    }

    // Save AI message
    const { data: savedMsg, error: msgError } = await supabase
      .from('messages')
      .insert([{
        chat_id: newChatId,
        role: 'ai',
        content: sanitizeInput(aiMessage),
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();

    if (msgError) return res.status(500).json({ error: 'Failed to save message' });

    // Update chat
    await supabase
      .from('chats')
      .update({
        last_message: sanitizeInput(userContent).substring(0, 100),
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    res.json({
      message: aiMessage,
      messageId: savedMsg.id,
      chatId: newChatId,
      timestamp: savedMsg.timestamp,
      isWebSearch: wasWebSearch,
      usedModel: usedModel
    });
  } catch (err) {
    console.error(`Chat error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Generate image - OPTIMIZED
app.post('/api/generate-image', authenticateToken, imageLimiter, async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid prompt', code: 'INVALID_INPUT' });
    }

    if (prompt.length > 500) {
      return res.status(400).json({ error: 'Prompt too long', code: 'PROMPT_TOO_LONG' });
    }

    const sanitizedPrompt = sanitizeInput(prompt);
    const userId = req.user.id;
    let newChatId = chatId;

    // Create or verify chat
    if (!chatId) {
      const { data: chat, error } = await supabase
        .from('chats')
        .insert([{ user_id: userId, title: `Image: ${sanitizedPrompt.substring(0, 40)}` }])
        .select()
        .single();

      if (error) return res.status(500).json({ error: 'Failed to create chat' });
      newChatId = chat.id;
    } else {
      const { data: chat } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chatId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!chat) return res.status(404).json({ error: 'Chat not found' });
      newChatId = chat.id;
    }

    // Save user message
    await supabase.from('messages').insert([{
      chat_id: newChatId,
      role: 'user',
      content: sanitizedPrompt,
      timestamp: new Date().toISOString()
    }]);

    const startTime = Date.now();
    const enhancedPrompt = await enhancePrompt(sanitizedPrompt, true);
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;

    // Fetch image
    const imageResponse = await fetch(imageUrl, {
      method: 'GET',
      headers: { 'Accept': 'image/*' }
    });

    if (!imageResponse.ok) {
      return res.status(500).json({ error: 'Image generation failed' });
    }

    const contentType = imageResponse.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(500).json({ error: 'Invalid image response' });
    }

    const imageBuffer = await imageResponse.buffer();
    const imageId = uuidv4();
    let finalImageUrl = imageUrl;

    // Try to store in Supabase
    const { error: storageError } = await supabase.storage
      .from('images')
      .upload(`public/${imageId}.png`, imageBuffer, {
        contentType: contentType,
        upsert: true
      });

    if (!storageError) {
      const { data: signedData } = await supabase.storage
        .from('images')
        .createSignedUrl(`public/${imageId}.png`, 60 * 60 * 24);
      
      if (signedData?.signedUrl) finalImageUrl = signedData.signedUrl;
    }

    // Verify image
    const verification = await verifyImageWithPolling(finalImageUrl);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const messageContent = `![Generated Image](${finalImageUrl})\n\n*Enhanced: ${enhancedPrompt}*\n*⏱️ ${elapsed}s ${verification.success ? '(verified)' : ''}*`;

    const { data: savedMsg, error: msgError } = await supabase
      .from('messages')
      .insert([{
        chat_id: newChatId,
        role: 'ai',
        content: messageContent,
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();

    if (msgError) return res.status(500).json({ error: 'Failed to save message' });

    await supabase
      .from('chats')
      .update({
        last_message: `Image: ${sanitizedPrompt.substring(0, 50)}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', newChatId);

    res.json({
      message: messageContent,
      imageUrl: finalImageUrl,
      enhancedPrompt: enhancedPrompt,
      messageId: savedMsg.id,
      chatId: newChatId,
      timestamp: savedMsg.timestamp
    });
  } catch (err) {
    console.error(`Image error: ${err.message}`);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Chat history
app.get('/api/chat/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 50);
    const offset = (page - 1) * limit;

    const { data: chats, error } = await supabase
      .from('chats')
      .select('id, title, last_message, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return res.status(500).json({ error: 'Failed to fetch history' });

    const history = await Promise.all(chats.map(async (chat) => {
      const { data: messages } = await supabase
        .from('messages')
        .select('id, role, content, timestamp')
        .eq('chat_id', chat.id)
        .order('timestamp', { ascending: true })
        .limit(100);

      return { ...chat, messages: messages || [] };
    }));

    res.json({ history, page, limit });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete chat
app.delete('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    if (!validate(chatId)) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    const { data: chat } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    await supabase.from('messages').delete().eq('chat_id', chatId);
    await supabase.from('chats').delete().eq('id', chatId).eq('user_id', userId);

    res.json({ message: 'Chat deleted', chatId });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete message
app.delete('/api/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    if (!validate(messageId)) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('chat_id')
      .eq('id', messageId)
      .maybeSingle();

    if (msgError || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', message.chat_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (chatError || !chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (deleteError) {
      return res.status(500).json({ error: 'Failed to delete message' });
    }

    const { data: lastMsg } = await supabase
      .from('messages')
      .select('content')
      .eq('chat_id', message.chat_id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsg) {
      await supabase
        .from('chats')
        .update({
          last_message: sanitizeInput(lastMsg.content).substring(0, 100),
          updated_at: new Date().toISOString()
        })
        .eq('id', message.chat_id);
    }

    res.json({ message: 'Message deleted', messageId });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// SPA catch-all
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  const indexPath = path.join(__dirname, 'test', 'frontend', 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(500).json({ error: 'Failed to serve app' });
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS error' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(process.env.PORT || 3001, () => {
  console.log(`========================================`);
  console.log(`🚀 Server running on port ${process.env.PORT || 3001}`);
  console.log(`========================================`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`\n⚡ Optimized Features:`);
  console.log(`   ├─ Racing mode: 2 fastest models compete`);
  console.log(`   ├─ Sequential fallback: tries all if racing fails`);
  console.log(`   ├─ Smart rate limit handling`);
  console.log(`   └─ Auto-learning performance tracking`);
  console.log(`\n🔍 Multi-source search: DuckDuckGo + Wikipedia`);
  console.log(`🔒 Security: Rate limiting + Helmet + CORS`);
  console.log(`\nVersion: 3.1.0 - Speed Optimized`);
  console.log(`========================================\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'test', 'frontend', 'dist'), { maxAge: '1d' }));
app.use(generalLimiter);

// Sanitize input
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return xss(input.trim(), {
    whiteList: {
      a: ['href'], img: ['src', 'alt'], b: [], strong: [], i: [], em: [], code: [], pre: [],
      ul: [], ol: [], li: [], p: [], br: []
    },
    stripIgnoreTag: true
  });
}

// JWT middleware
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token', code: 'NO_TOKEN' });

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    req.user = user;
    next();
  });
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    version: '3.1.0',
    features: [
      '⚡ Optimized for speed',
      '🚀 Sequential + Racing modes',
      '🔍 Multi-source search',
      '🎯 Smart rate limiting',
      '🔒 Security hardened'
    ]
  });
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    
    res.json({
      status: 'OK',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(503).json({ status: 'ERROR' });
  }
});

// Model stats
app.get('/api/model-stats', (req, res) => {
  const stats = {};
  for (const [modelId, data] of modelStats.entries()) {
    const total = data.successCount + data.failCount;
    stats[modelId] = {
      successRate: total > 0 ? ((data.successCount / total) * 100).toFixed(1) + '%' : 'N/A',
      avgResponseTime: data.avgResponseTime > 0 ? data.avgResponseTime.toFixed(0) + 'ms' : 'N/A',
      totalCalls: total
    };
  }
  res.json({ stats });
});

// Register
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing fields', code: 'INVALID_INPUT' });
    }

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedName = sanitizeInput(name);

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password too short', code: 'INVALID_PASSWORD' });
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', sanitizedEmail)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Email exists', code: 'EMAIL_EXISTS' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase
      .from('users')
      .insert([{ email: sanitizedEmail, password: hashedPassword, name: sanitizedName }])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Registration failed', code: 'DATABASE_ERROR' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Login
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing credentials', code: 'INVALID_INPUT' });
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

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// Chat endpoint - OPTIMIZED
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { messages, chatId, prompt } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages', code: 'INVALID_INPUT' });
    }

    const userId = req.user.id;
    let newChatId = chatId;

    // Create or verify chat
    if (!chatId) {
      const firstMsg = sanitizeInput(prompt || messages[0]?.content || 'New chat');
      const { data: chat, error } = await supabase
        .from('chats')
        .insert([{ user_id: userId, title: firstMsg.substring(0, 50) }])
        .select()
        .single();

      if (error) return res.status(500).json({ error: 'Failed to create chat' });
      newChatId = chat.id;
    } else {
