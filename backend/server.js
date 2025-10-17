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
import * as cheerio from 'cheerio';
import { LRUCache } from 'lru-cache';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== CONFIGURATION ====================
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'JWT_SECRET', 'GEMINI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Parse comma-separated API keys
const openRouterKeys = process.env.OPENROUTER_API_KEY
  .split(',')
  .map(key => key.trim())
  .filter(key => key.length > 0);

const geminiKeys = process.env.GEMINI_API_KEY
  .split(',')
  .map(key => key.trim())
  .filter(key => key.length > 0);

const jwtSecret = process.env.JWT_SECRET;

// STRATEGY: Using Gemini 2.0 Flash as primary model for all categories
const AI_MODEL = {
  id: 'gemini-2.0-flash',
  timeout: 60000,
  name: 'Gemini-2.0-Flash'
};

// Fallback model for when Gemini fails
const FALLBACK_MODEL = {
  id: 'z-ai/glm-4.5-air:free',
  timeout: 60000,
  name: 'GLM-4.5-Air'
};

// Image generation models configuration
const IMAGE_MODELS = {
  primary: {
    name: 'stability-ai/stable-diffusion-xl',
    api: 'openrouter',
    width: 1024,
    height: 1024,
    steps: 30,
    guidance_scale: 7.5,
    timeout: 60000
  },
  fallback: {
    name: 'dall-e-3',
    api: 'openai',
    width: 1024,
    height: 1024,
    quality: 'hd',
    timeout: 60000
  }
};

// ==================== MODEL MANAGEMENT ====================
const modelStats = new Map();
const rateLimitTracker = new Map();
const currentOpenRouterKeyIndex = { value: 0 };
const currentGeminiKeyIndex = { value: 0 };

// Enhanced caching with LRU strategy
const imageCache = new LRUCache({
  max: 500, // Maximum number of items
  ttl: 1000 * 60 * 60 * 24, // 24 hours
  updateAgeOnGet: true
});

// Add cache for search results
const searchCache = new LRUCache({
  max: 200,
  ttl: 1000 * 60 * 30, // 30 minutes
  updateAgeOnGet: true
});

// Add cache for prompt enhancements
const promptCache = new LRUCache({
  max: 300,
  ttl: 1000 * 60 * 60, // 1 hour
  updateAgeOnGet: true
});

// Add cache for user sessions
const userCache = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 15, // 15 minutes
  updateAgeOnGet: true
});

// Generate a cache key from the prompt
function getCacheKey(prompt) {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

// Check if image is in cache
function getCachedImage(prompt) {
  const key = getCacheKey(prompt);
  return imageCache.get(key);
}

// Store image in cache
function cacheImage(prompt, imageUrl) {
  const key = getCacheKey(prompt);
  imageCache.set(key, {
    url: imageUrl,
    timestamp: Date.now()
  });
}

// Check if search result is in cache
function getCachedSearch(query) {
  const key = getCacheKey(query);
  return searchCache.get(key);
}

// Store search result in cache
function cacheSearch(query, result) {
  const key = getCacheKey(query);
  searchCache.set(key, result);
}

// Check if prompt enhancement is in cache
function getCachedPrompt(prompt) {
  const key = getCacheKey(prompt);
  return promptCache.get(key);
}

// Store prompt enhancement in cache
function cachePrompt(prompt, enhanced) {
  const key = getCacheKey(prompt);
  promptCache.set(key, enhanced);
}

// Check if user session is in cache
function getCachedUser(userId) {
  return userCache.get(userId);
}

// Store user session in cache
function cacheUser(userId, userData) {
  userCache.set(userId, userData);
}

function initModelStats() {
  modelStats.set(AI_MODEL.id, { successCount: 0, failCount: 0, lastUsed: null, rateLimitCount: 0 });
  modelStats.set(FALLBACK_MODEL.id, { successCount: 0, failCount: 0, lastUsed: null, rateLimitCount: 0 });
  
  rateLimitTracker.set(AI_MODEL.id, { isRateLimited: false, rateLimitUntil: null });
  rateLimitTracker.set(FALLBACK_MODEL.id, { isRateLimited: false, rateLimitUntil: null });
}
initModelStats();

function isModelRateLimited(id) {
  const t = rateLimitTracker.get(id);
  if (!t || !t.isRateLimited) return false;
  if (t.rateLimitUntil && Date.now() < t.rateLimitUntil) return true;
  t.isRateLimited = false;
  t.rateLimitUntil = null;
  rateLimitTracker.set(id, t);
  return false;
}

function markModelRateLimited(id, secs = 300) {
  const t = rateLimitTracker.get(id) || {};
  t.isRateLimited = true;
  t.rateLimitUntil = Date.now() + secs * 1000;
  rateLimitTracker.set(id, t);
  const s = modelStats.get(id);
  if (s) {
    s.rateLimitCount++;
    modelStats.set(id, s);
  }
  console.log(`⚠️  Model ${id} rate limited for ${secs}s (total: ${s?.rateLimitCount || 0})`);
}

function parseRetryAfter(msg) {
  const m = msg.match(/(\d+)\s*seconds?/i);
  return m ? parseInt(m[1]) : 300;
}

function updateModelStats(id, ok) {
  const s = modelStats.get(id);
  if (!s) return;
  if (ok) s.successCount++;
  else s.failCount++;
  s.lastUsed = Date.now();
  modelStats.set(id, s);
}

function getNextOpenRouterKey() {
  if (openRouterKeys.length === 0) return null;
  const key = openRouterKeys[currentOpenRouterKeyIndex.value];
  currentOpenRouterKeyIndex.value = (currentOpenRouterKeyIndex.value + 1) % openRouterKeys.length;
  return key;
}

function getNextGeminiKey() {
  if (geminiKeys.length === 0) return null;
  const key = geminiKeys[currentGeminiKeyIndex.value];
  currentGeminiKeyIndex.value = (currentGeminiKeyIndex.value + 1) % geminiKeys.length;
  return key;
}

// ==================== AI MODEL CALLING ====================
// CORE: Using Gemini 2.0 Flash as primary model for all operations with fallback
async function callAISingleModel(msgs, cat = 'chat', opts = {}) {
  const { temperature = 0.7, maxTokens = 500 } = opts;
  
  // Try Gemini first
  if (!isModelRateLimited(AI_MODEL.id)) {
    try {
      return await callGeminiModel(msgs, temperature, maxTokens);
    } catch (e) {
      console.log(`Gemini failed: ${e.message}`);
      updateModelStats(AI_MODEL.id, false);
      
      // If Gemini fails, try OpenRouter
      if (!isModelRateLimited(FALLBACK_MODEL.id)) {
        try {
          return await callOpenRouterModel(msgs, temperature, maxTokens);
        } catch (e2) {
          console.log(`OpenRouter failed: ${e2.message}`);
          updateModelStats(FALLBACK_MODEL.id, false);
          throw new Error('All AI models failed');
        }
      } else {
        throw new Error('All AI models are rate limited');
      }
    }
  } else if (!isModelRateLimited(FALLBACK_MODEL.id)) {
    // Gemini is rate limited, try OpenRouter
    try {
      return await callOpenRouterModel(msgs, temperature, maxTokens);
    } catch (e) {
      console.log(`OpenRouter failed: ${e.message}`);
      updateModelStats(FALLBACK_MODEL.id, false);
      throw new Error('All AI models failed');
    }
  } else {
    throw new Error('All AI models are rate limited');
  }
}

async function callGeminiModel(msgs, temperature, maxTokens) {
  const apiKey = getNextGeminiKey();
  if (!apiKey) throw new Error('No Gemini API keys available');
  
  const t0 = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), AI_MODEL.timeout);
  
  try {
    console.log(`🤖 Using ${AI_MODEL.name} with API key ending in ${apiKey.slice(-4)}...`);
    
    // Convert messages to Gemini format
    const geminiMsgs = msgs.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: msg.content }]
    }));
    
    // Fix: Use the correct Gemini API endpoint for 2.0 Flash
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL.id}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: geminiMsgs,
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxTokens,
        }
      }),
      signal: ctrl.signal
    });
    
    clearTimeout(to);
    const dt = Date.now() - t0;
    
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      console.log(`   ❌ ${AI_MODEL.name} failed (${r.status}) in ${dt}ms`);
      console.log(`   Error details: ${err}`);
      
      if (r.status === 429 || err.toLowerCase().includes('rate limit')) {
        const retrySecs = parseRetryAfter(err);
        markModelRateLimited(AI_MODEL.id, retrySecs);
      }
      
      throw new Error(`Gemini failed with status ${r.status}`);
    }
    
    const data = await r.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      console.log(`   ❌ ${AI_MODEL.name} returned empty content`);
      throw new Error('Gemini returned empty content');
    }
    
    console.log(`   ✅ ${AI_MODEL.name} succeeded in ${dt}ms`);
    updateModelStats(AI_MODEL.id, true);
    
    return { content, modelId: AI_MODEL.id, modelName: AI_MODEL.name, responseTime: dt };
    
  } catch (e) {
    clearTimeout(to);
    const dt = Date.now() - t0;
    
    if (e.name === 'AbortError') {
      console.log(`   ⏱️  ${AI_MODEL.name} timeout after ${dt}ms`);
      throw new Error('Gemini request timed out');
    } else {
      console.log(`   ❌ ${AI_MODEL.name} error: ${e.message}`);
      throw e;
    }
  }
}

async function callOpenRouterModel(msgs, temperature, maxTokens) {
  const apiKey = getNextOpenRouterKey();
  if (!apiKey) throw new Error('No OpenRouter API keys available');
  
  const t0 = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FALLBACK_MODEL.timeout);
  
  try {
    console.log(`🤖 Using ${FALLBACK_MODEL.name} with API key ending in ${apiKey.slice(-4)}...`);
    
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hein1.onrender.com',
        'X-Title': 'Hein AI'
      },
      body: JSON.stringify({ model: FALLBACK_MODEL.id, messages: msgs, temperature, max_tokens: maxTokens }),
      signal: ctrl.signal
    });
    
    clearTimeout(to);
    const dt = Date.now() - t0;
    
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      console.log(`   ❌ ${FALLBACK_MODEL.name} failed (${r.status}) in ${dt}ms`);
      
      if (r.status === 429 || err.toLowerCase().includes('rate limit')) {
        const retrySecs = parseRetryAfter(err);
        markModelRateLimited(FALLBACK_MODEL.id, retrySecs);
      }
      
      throw new Error(`OpenRouter failed with status ${r.status}`);
    }
    
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.log(`   ❌ ${FALLBACK_MODEL.name} returned empty content`);
      throw new Error('OpenRouter returned empty content');
    }
    
    console.log(`   ✅ ${FALLBACK_MODEL.name} succeeded in ${dt}ms`);
    updateModelStats(FALLBACK_MODEL.id, true);
    
    return { content, modelId: FALLBACK_MODEL.id, modelName: FALLBACK_MODEL.name, responseTime: dt };
    
  } catch (e) {
    clearTimeout(to);
    const dt = Date.now() - t0;
    
    if (e.name === 'AbortError') {
      console.log(`   ⏱️  ${FALLBACK_MODEL.name} timeout after ${dt}ms`);
      throw new Error('OpenRouter request timed out');
    } else {
      console.log(`   ❌ ${FALLBACK_MODEL.name} error: ${e.message}`);
      throw e;
    }
  }
}

// ==================== PROMPT ENHANCEMENT ====================
async function enhancePrompt(txt, isImg = false) {
  // Check cache first
  const cacheKey = `${txt}_${isImg ? 'img' : 'text'}`;
  const cached = getCachedPrompt(cacheKey);
  if (cached) return cached;
  
  try {
    const sys = isImg 
      ? 'You are the one to improve the image prompt. Translate to English if needed, add artistic details, lighting, composition and style, perspective, realism. Max 120 characters. Only return the improved prompt, no explanation needed.' 
      : 'You are a prompt enhancer. Make the prompt clearer, more specific, and better structured. Max 200 characters. Only return the enhanced prompt, no explanation.';
    
    const r = await callAISingleModel([
      { role: 'system', content: sys },
      { role: 'user', content: `Enhance: "${txt}"` }
    ], 'quick', { maxTokens: isImg ? 150 : 200 });
    
    const e = r.content.trim() || txt;
    const max = isImg ? 200 : 500;
    const result = e.length > max ? e.substring(0, max - 3) + '...' : e;
    
    // Cache the result
    cachePrompt(cacheKey, result);
    
    return result;
  } catch {
    return txt;
  }
}

// ==================== SEARCH DETECTION ====================
function hasExplicitSearchKeyword(msg) {
  const explicitPrefixes = [
    /^tìm kiếm:/i,
    /^search:/i,
    /^tra cứu:/i,
    /^google:/i,
    /^tìm:/i,
    /^find:/i,
    /^lookup:/i
  ];
  
  return explicitPrefixes.some(prefix => prefix.test(msg.trim()));
}

function isProductQuery(msg) {
  const ml = msg.toLowerCase();
  
  const productPatterns = [
    /\b(dell|hp|lenovo|asus|acer|msi|apple|samsung|xiaomi|oppo|vivo)\s+[a-z]?\d{3,}/i,
    /\b(iphone|galaxy|pixel|macbook|thinkpad|inspiron|latitude|pavilion|vivobook)\s+\d+/i,
    /\b(rtx|gtx|radeon)\s+\d{4}/i,
    /(giá|price)\s+(của\s+)?(dell|hp|lenovo|iphone|samsung|xiaomi|laptop|phone)/i,
    /(cấu hình|specs?|specification|thông số|review|đánh giá)\s+(của\s+)?[a-z]+\s*\d+/i,
    /\b(mua|buy|bán|selling)\s+(dell|hp|lenovo|iphone|samsung|laptop|phone)/i
  ];
  
  return productPatterns.some(p => p.test(ml));
}

function isRealTimeQuery(msg) {
  const ml = msg.toLowerCase();
  
  const realTimeIndicators = [
    /\b(hôm nay|today|ngày hôm nay)\b/i,
    /\b(bây giờ|now|hiện tại|current|currently)\b/i,
    /\b(tin tức|news|mới nhất|latest|gần đây|recent)\b/i,
    /\b(thời tiết|weather|nhiệt độ|temperature|forecast|dự báo)\b/i,
    /\b(giá bitcoin|bitcoin price|crypto price|tỷ giá|exchange rate)\b/i,
    /\b(năm\s+(20\d{2}|nay|này|next)|year\s+(20\d{2}|next))\b/i,
    /\b(sự kiện|event|diễn ra|happening|occurred)\b.*\b(hôm nay|today|recently|gần đây)\b/i
  ];
  
  return realTimeIndicators.some(p => p.test(ml));
}

function isSpecificFactualQuestion(msg) {
  const ml = msg.toLowerCase();
  
  // Only SPECIFIC factual questions about real people/places/products
  const specificFactual = [
    /\b(là ai|who is|ai là)\b\s+[A-Z][a-z]+/i, // Who is [Name]
    /\b(ceo|founder|president|giám đốc|chủ tịch)\s+(của|of)\s+[a-z]+/i,
    /\b(ở đâu|where is|where)\b.*\b(công ty|company|trụ sở|headquarters)/i,
    /\b(khi nào|when)\b.*\b(ra mắt|released|launch|phát hành)/i,
    /\b(bao nhiêu|how much|how many)\b.*\b(giá|price|cost|phí)/i
  ];
  
  return specificFactual.some(p => p.test(ml));
}

function shouldNotSearch(msg) {
  const ml = msg.toLowerCase();
  
  // Definitely NOT search - general knowledge, coding, creative tasks
  const noSearchPatterns = [
    /^(giải thích|explain|định nghĩa|define|cho tôi biết|tell me about|what does|nghĩa là gì)/i,
    /^(làm thế nào|how to|cách|way to|hướng dẫn|guide|tutorial)/i,
    /^(viết|write|tạo|create|code|lập trình|program|develop)/i,
    /^(tính|calculate|giải|solve|compute)/i,
    /^(dịch|translate|chuyển)/i,
    /^(so sánh|compare|khác nhau|difference between)\s+(khái niệm|concept|idea)/i,
    /^(ưu điểm|advantage|nhược điểm|disadvantage)\s+(của|of)\s+(việc|the)/i,
    /\b(là gì|what is)\b\s+(trong|in)\s+(toán học|math|lập trình|programming|khoa học|science)/i,
    /^(tóm tắt|summarize|tổng hợp|analyze)/i,
    /^(nghĩ|think|cảm thấy|feel|ý kiến|opinion)/i,
    /\b(code|function|algorithm|thuật toán|hàm|biến|variable)\b/i,
    /\b(học|learn|studying|nghiên cứu|research)\s+(về|about)/i
  ];
  
  return noSearchPatterns.some(p => p.test(ml));
}

async function shouldSearchWeb(msg) {
  try {
    // 1. Có keyword rõ ràng -> SEARCH
    if (hasExplicitSearchKeyword(msg)) {
      console.log('   ✓ Explicit search keyword detected');
      return true;
    }
    
    // 2. Chắc chắn KHÔNG search
    if (shouldNotSearch(msg)) {
      console.log('   ✗ General knowledge/coding query - no search');
      return false;
    }
    
    // 3. Product query -> SEARCH
    if (isProductQuery(msg)) {
      console.log('   ✓ Product query detected');
      return true;
    }
    
    // 4. Real-time query -> SEARCH
    if (isRealTimeQuery(msg)) {
      console.log('   ✓ Real-time query detected');
      return true;
    }
    
    // 5. Specific factual question -> SEARCH
    if (isSpecificFactualQuestion(msg)) {
      console.log('   ✓ Specific factual question detected');
      return true;
    }
    
    // 6. Nếu không rõ ràng, KHÔNG search (default to chat)
    console.log('   ✗ General query - using chat');
    return false;
    
  } catch (e) {
    console.error('   Error in shouldSearchWeb:', e.message);
    return false; // Default to chat on error
  }
}

// ==================== SEARCH FUNCTIONS ====================
function detectQueryType(query) {
  const ql = query.toLowerCase();
  
  const productPatterns = [
    /\b(dell|hp|lenovo|asus|acer|msi)\s+[a-z]?\d{4,}/i,
    /\b(iphone|galaxy|pixel|oneplus|xiaomi|oppo|vivo)\s+\d+/i,
    /\b(macbook|thinkpad|inspiron|latitude|vostro|pavilion|vivobook)\s+[a-z]?\d+/i,
    /\b(rtx|gtx|radeon)\s+\d{4}/i,
    /\b(core\s+i\d|ryzen\s+\d)/i
  ];
  
  if (productPatterns.some(p => p.test(query))) return 'product_specific';
  
  const brands = ['apple', 'samsung', 'dell', 'hp', 'lenovo', 'asus', 'xiaomi'];
  if (brands.some(b => ql.includes(b))) return 'brand_related';
  
  const techKw = ['specs', 'specification', 'review', 'benchmark', 'performance', 'cấu hình', 'thông số', 'đánh giá'];
  if (techKw.some(k => ql.includes(k))) return 'technical';
  
  return 'general';
}

function getFallbackSites(query, isVN) {
  const ql = query.toLowerCase();
  
  if (ql.includes('laptop') || ql.includes('dell') || ql.includes('hp') || ql.includes('lenovo') || ql.includes('asus')) {
    return isVN
      ? ['https://www.notebookcheck.net', 'https://tinhte.vn', 'https://www.laptopmag.com', 'https://fptshop.com.vn', 'https://www.pcmag.com']
      : ['https://www.notebookcheck.net', 'https://www.laptopmag.com', 'https://www.pcmag.com', 'https://www.theverge.com', 'https://www.tomshardware.com'];
  }
  
  if (ql.includes('iphone') || ql.includes('apple') || ql.includes('samsung') || ql.includes('galaxy')) {
    return isVN 
      ? ['https://www.gsmarena.com', 'https://www.apple.com', 'https://tinhte.vn', 'https://thegioididong.com', 'https://fptshop.com.vn']
      : ['https://www.gsmarena.com', 'https://www.apple.com', 'https://www.samsung.com', 'https://www.theverge.com', 'https://www.cnet.com'];
  }
  
  return isVN
    ? ['https://vi.wikipedia.org', 'https://tinhte.vn', 'https://genk.vn', 'https://vnexpress.net', 'https://en.wikipedia.org']
    : ['https://en.wikipedia.org', 'https://www.theverge.com', 'https://www.cnet.com', 'https://www.bbc.com', 'https://www.reuters.com'];
}

async function suggestWebsites(query) {
  try {
    const isVN = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíĩỉịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(query);
    const queryType = detectQueryType(query);
    
    let productModel = '';
    const modelMatch = query.match(/\b([a-z]+)\s+([a-z]?\d{4,})/i);
    if (modelMatch) productModel = modelMatch[0];
    
    const sysPrompt = isVN 
      ? `Đề xuất 7 trang web TỐT NHẤT cho: "${query}"
 ${productModel ? `Sản phẩm: ${productModel}` : ''}
Loại: ${queryType}

Ưu tiên: trang chính thức, review uy tín, Wikipedia, tin công nghệ
Trả về JSON: ["url1", "url2", ...]`
      : `Suggest 7 BEST websites for: "${query}"
 ${productModel ? `Product: ${productModel}` : ''}
Type: ${queryType}

Priority: official sites, reviews, Wikipedia, tech news
Return JSON: ["url1", "url2", ...]`;

    let r;
    try {
      r = await callAISingleModel([
        { role: 'system', content: sysPrompt },
        { role: 'user', content: `Find websites for: "${query}"` }
      ], 'research', { temperature: 0.1, maxTokens: 400 });
    } catch {
      console.log('   Research failed, using quick');
      r = await callAISingleModel([
        { role: 'system', content: sysPrompt },
        { role: 'user', content: `Find websites for: "${query}"` }
      ], 'quick', { temperature: 0.1, maxTokens: 400 });
    }
    
    const jsonMatch = r.content.trim().match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return getFallbackSites(query, isVN);
    
    const sites = JSON.parse(jsonMatch[0]);
    const validSites = sites.filter(s => typeof s === 'string' && s.startsWith('http')).slice(0, 7);
    
    if (validSites.length === 0) return getFallbackSites(query, isVN);
    
    if (validSites.length < 5) {
      const fallback = getFallbackSites(query, isVN);
      fallback.forEach(site => {
        if (validSites.length < 7 && !validSites.includes(site)) validSites.push(site);
      });
    }
    
    return validSites;
  } catch (e) {
    console.error('   Error suggesting websites:', e.message);
    return getFallbackSites(query, /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíĩỉịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(query));
  }
}

// ==================== IMPROVED SEARCH FUNCTIONS ====================
async function searchDuckDuckGo(query) {
  try {
    const eq = encodeURIComponent(query);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    
    const r = await fetch(`https://api.duckduckgo.com/?q=${eq}&format=json&no_html=1&skip_disambig=1`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    clearTimeout(to);
    
    if (!r.ok) {
      console.log(`   ❌ DuckDuckGo search failed: ${r.status}`);
      return [];
    }
    
    const data = await r.json();
    const results = [];
    
    // Add abstract if available
    if (data.Abstract) {
      results.push({
        title: data.Heading || 'Answer',
        snippet: data.Abstract,
        link: data.AbstractURL || '',
        source: 'DuckDuckGo',
        priority: 10
      });
    }
    
    // Add related topics
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 5).forEach(t => {
        if (t.Text && t.FirstURL) {
          const domain = new URL(t.FirstURL).hostname.replace('www.', '');
          results.push({
            title: t.Text.split(' - ')[0],
            snippet: t.Text,
            link: t.FirstURL,
            source: domain,
            priority: 8
          });
        }
      });
    }
    
    return results;
  } catch (e) {
    console.error('   Error in DuckDuckGo search:', e.message);
    return [];
  }
}

async function searchWikipedia(query) {
  try {
    const eq = encodeURIComponent(query);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${eq}&format=json&srlimit=3&origin=*`, { 
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    clearTimeout(to);
    
    if (!r.ok) {
      console.log(`   ❌ Wikipedia search failed: ${r.status}`);
      return [];
    }
    
    const data = await r.json();
    const results = [];
    
    if (data.query && data.query.search && Array.isArray(data.query.search)) {
      data.query.search.forEach(item => {
        results.push({
          title: item.title,
          snippet: item.snippet.replace(/<[^>]*>/g, ''),
          link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
          source: 'wikipedia.org',
          priority: 7
        });
      });
    }
    
    return results;
  } catch (e) {
    console.error('   Error in Wikipedia search:', e.message);
    return [];
  }
}

async function searchSpecificSites(query, sites) {
  const results = [];
  let productModel = '';
  const modelMatch = query.match(/\b([a-z]+)\s+([a-z]?\d{4,})/i);
  if (modelMatch) productModel = modelMatch[0];
  
  for (const site of sites) {
    try {
      const domain = new URL(site).hostname.replace('www.', '');
      const searchQuery = productModel ? `${productModel} specifications review` : query;
      const siteSearch = `${searchQuery} site:${domain}`;
      const eq = encodeURIComponent(siteSearch);
      
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      
      const r = await fetch(`https://api.duckduckgo.com/?q=${eq}&format=json&no_html=1`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      clearTimeout(to);
      
      if (r.ok) {
        const data = await r.json();
        
        if (data.Abstract) {
          results.push({
            title: data.Heading || 'Result',
            snippet: data.Abstract,
            link: data.AbstractURL || site,
            source: domain,
            priority: 10
          });
        }
        
        if (data.RelatedTopics) {
          data.RelatedTopics.slice(0, 5).forEach(t => {
            if (t.Text && t.FirstURL) {
              const topicDomain = new URL(t.FirstURL).hostname.replace('www.', '');
              if (topicDomain === domain || t.FirstURL.includes(domain)) {
                results.push({
                  title: t.Text.split(' - ')[0],
                  snippet: t.Text,
                  link: t.FirstURL,
                  source: domain,
                  priority: 8
                });
              }
            }
          });
        }
      }
    } catch (e) {
      console.error(`Error searching ${site}:`, e.message);
    }
  }
  
  return results;
}

async function crawlWebpage(url) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    
    clearTimeout(to);
    if (!r.ok) return null;
    
    const html = await r.text();
    const $ = cheerio.load(html);
    
    $('script, style, nav, header, footer, iframe, noscript').remove();
    
    const title = $('title').text().trim() || $('h1').first().text().trim();
    
    const contentSelectors = [
      'article', '[role="main"]', 'main', '.content', '.article-content',
      '.post-content', '#content', '.entry-content', '.product-description',
      '.specs-table', '.specifications', '.review-content'
    ];
    
    let content = '';
    for (const sel of contentSelectors) {
      const elem = $(sel);
      if (elem.length > 0) {
        content = elem.text();
        break;
      }
    }
    
    if (!content) content = $('body').text();
    
    const specs = {};
    $('table.specs, table.specifications, .spec-table').each((i, table) => {
      $(table).find('tr').each((j, row) => {
        const cells = $(row).find('td, th');
        if (cells.length >= 2) {
          const key = $(cells[0]).text().trim();
          const value = $(cells[1]).text().trim();
          if (key && value) specs[key] = value;
        }
      });
    });
    
    if (Object.keys(specs).length > 0) {
      content += '\n\n=== SPECIFICATIONS ===\n';
      for (const [key, value] of Object.entries(specs)) {
        content += `${key}: ${value}\n`;
      }
    }
    
    content = content.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim().substring(0, 5000);
    
    return { title, content, url, specs };
  } catch (e) {
    console.error(`Error crawling ${url}:`, e.message);
    return null;
  }
}

async function smartSearch(query) {
  console.log(`\n🔍 Smart Search: "${query}"`);
  
  // Check cache first
  const cached = getCachedSearch(query);
  if (cached) {
    console.log('   Using cached search results');
    return cached;
  }
  
  const queryType = detectQueryType(query);
  console.log(`   Type: ${queryType}`);
  
  try {
    console.log('📍 Step 1: Suggesting websites...');
    const suggestedSites = await suggestWebsites(query);
    console.log(`   Found ${suggestedSites.length} sites`);
    
    console.log('🔎 Step 2: Searching multiple sources...');
    
    // Search from multiple sources in parallel
    const searchPromises = [
      searchDuckDuckGo(query),
      searchWikipedia(query),
      searchSpecificSites(query, suggestedSites)
    ];
    
    const searchResults = await Promise.allSettled(searchPromises);
    const allResults = [];
    
    searchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        console.log(`   Source ${index + 1}: ${result.value.length} results`);
        allResults.push(...result.value);
      } else {
        console.log(`   Source ${index + 1}: Failed`);
      }
    });
    
    // Remove duplicates based on URL
    const uniqueResults = [];
    const seenUrls = new Set();
    
    allResults.forEach(result => {
      if (result.link && !seenUrls.has(result.link)) {
        seenUrls.add(result.link);
        uniqueResults.push(result);
      }
    });
    
    // Sort by priority
    uniqueResults.sort((a, b) => b.priority - a.priority);
    
    console.log(`   Total unique results: ${uniqueResults.length}`);
    
    console.log('📥 Step 3: Crawling top pages...');
    let topUrls = uniqueResults.slice(0, 5).map(r => r.link).filter(Boolean);
    
    if (topUrls.length === 0) {
      console.log('   No results, crawling suggested sites');
      topUrls = suggestedSites.slice(0, 5);
    }
    
    if (topUrls.length === 0) {
      const result = { query, queryType, suggestedSites, searchResults: [], crawledData: [], totalSources: 0 };
      cacheSearch(query, result);
      return result;
    }
    
    const crawlPromises = topUrls.map(url => crawlWebpage(url));
    const crawledData = (await Promise.all(crawlPromises)).filter(d => d !== null);
    console.log(`   Crawled ${crawledData.length}/${topUrls.length} pages`);
    
    const result = {
      query,
      queryType,
      suggestedSites,
      searchResults: uniqueResults,
      crawledData,
      totalSources: crawledData.length + uniqueResults.length
    };
    
    // Cache the result
    cacheSearch(query, result);
    
    return result;
  } catch (e) {
    console.error('   Error:', e.message);
    const result = { query, queryType: 'general', suggestedSites: [], searchResults: [], crawledData: [], totalSources: 0 };
    cacheSearch(query, result);
    return result;
  }
}

async function summarizeSearchResults(query, searchData) {
  if (searchData.totalSources === 0) return 'Không tìm thấy thông tin phù hợp.';
  
  try {
    let context = '';
    let sourceCount = 0;
    
    if (searchData.crawledData && searchData.crawledData.length > 0) {
      context += '=== CRAWLED CONTENT ===\n\n';
      searchData.crawledData.forEach((data, i) => {
        context += `[${i + 1}] ${data.title}\nURL: ${data.url}\n${data.content.substring(0, 2000)}\n\n`;
        sourceCount++;
      });
    }
    
    if (searchData.searchResults && searchData.searchResults.length > 0) {
      context += '\n=== SEARCH RESULTS ===\n\n';
      searchData.searchResults.slice(0, 5).forEach((r, i) => {
        context += `[${sourceCount + i + 1}] ${r.title}\n${r.snippet.substring(0, 300)}\nSource: ${r.source}\n\n`;
      });
    }
    
    context = context.substring(0, 6000);
    
    const isVN = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệ]/i.test(query);
    const queryType = searchData.queryType || 'general';
    
    let sysPrompt = `You are a research assistant. Synthesize information.
Language: ${isVN ? 'Vietnamese' : 'English'}
Type: ${queryType}

Format:
1. Direct answer (2-3 sentences)
2. Key points (bullets)
3. Cite [1], [2]

Max 600 words.`;

    if (queryType === 'product_specific') {
      sysPrompt += `\n\nFOCUS: specs, features, pricing, pros/cons`;
    }
    
    const r = await callAISingleModel([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: `Query: "${query}"\n\nInfo:\n${context}` }
    ], 'chat', { temperature: 0.3, maxTokens: 800 });
    
    let summary = r.content.trim().replace(/\*\*/g, '');
    
    const sources = [];
    if (searchData.crawledData) {
      searchData.crawledData.forEach((d, i) => {
        try {
          const domain = new URL(d.url).hostname.replace('www.', '');
          sources.push(`[${i + 1}] [${domain}](${d.url})`);
        } catch {
          sources.push(`[${i + 1}] ${d.url}`);
        }
      });
    }
    
    if (searchData.searchResults && sources.length < 5) {
      searchData.searchResults.slice(0, 5 - sources.length).forEach((r, i) => {
        if (r.link) {
          try {
            sources.push(`[${sources.length + 1}] [${r.source}](${r.link})`);
          } catch {
            sources.push(`[${sources.length + 1}] ${r.source}`);
          }
        }
      });
    }
    
    if (sources.length > 0) {
      summary += '\n\n---\n**Nguồn:**\n' + sources.join(' • ');
    }
    
    return summary;
  } catch (e) {
    console.error('Error summarizing:', e);
    return 'Đã tìm thấy thông tin nhưng không thể tổng hợp.';
  }
}

// ==================== IMPROVED IMAGE GENERATION ====================
async function generateDetailedImagePrompt(userPrompt) {
  try {
    const isVN = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíĩỉịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(userPrompt);
    
    const sysPrompt = isVN 
      ? `Bạn là một chuyên gia về nghệ thuật và hình ảnh. Tạo prompt chi tiết cho việc tạo hình ảnh chất lượng cao.
      
Phân tích yêu cầu và tạo prompt bao gồm:
1. Chủ thể chính (main subject) - mô tả chi tiết
2. Phong cách nghệ thuật (art style) - ví dụ: photorealistic, digital art, oil painting, etc.
3. Ánh sáng (lighting) - ví dụ: cinematic lighting, soft light, golden hour, etc.
4. Bố cục (composition) - ví dụ: close-up, wide angle, rule of thirds, etc.
5. Màu sắc (color palette) - ví dụ: vibrant colors, monochromatic, warm tones, etc.
6. Chi tiết bổ sung (additional details) - ví dụ: textures, background, atmosphere
7. Chất lượng (quality) - thêm "highly detailed, 8k, masterpiece"

Prompt phải bằng tiếng Anh, không quá 150 từ, chỉ trả về prompt, không giải thích.`
      : `You are an art and image expert. Create a detailed prompt for high-quality image generation.
      
Analyze the request and create a detailed prompt including:
1. Main subject - detailed description
2. Art style - e.g., photorealistic, digital art, oil painting, etc.
3. Lighting - e.g., cinematic lighting, soft light, golden hour, etc.
4. Composition - e.g., close-up, wide angle, rule of thirds, etc.
5. Color palette - e.g., vibrant colors, monochromatic, warm tones, etc.
6. Additional details - e.g., textures, background, atmosphere
7. Quality - add "highly detailed, 8k, masterpiece"

The prompt must be in English, no more than 150 words, and only return the prompt, no explanation.`;

    const r = await callAISingleModel([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: `Create a detailed image prompt for: "${userPrompt}"` }
    ], 'quick', { temperature: 0.7, maxTokens: 300 });
    
    return r.content.trim();
  } catch (e) {
    console.error('Error generating detailed prompt:', e);
    return userPrompt;
  }
}

async function translateToEnglish(text) {
  try {
    const isVN = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíĩỉịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(text);
    
    if (!isVN) return text; // Already in English
    
    const r = await callAISingleModel([
      { role: 'system', content: 'You are a professional translator. Translate the given Vietnamese text to English. Only return the translated text, no explanation.' },
      { role: 'user', content: text }
    ], 'quick', { temperature: 0.1, maxTokens: 200 });
    
    return r.content.trim();
  } catch (e) {
    console.error('Error translating to English:', e);
    return text;
  }
}

// Improved image generation with multiple APIs
async function generateImageWithAPI(prompt, model) {
  if (model.api === 'openrouter') {
    return await generateImageWithOpenRouter(prompt, model);
  } else if (model.api === 'openai') {
    return await generateImageWithOpenAI(prompt, model);
  } else {
    throw new Error(`Unknown image API: ${model.api}`);
  }
}

async function generateImageWithOpenRouter(prompt, model) {
  const apiKey = getNextOpenRouterKey();
  if (!apiKey) throw new Error('No OpenRouter API keys available');
  
  const t0 = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), model.timeout);
  
  try {
    console.log(`🎨 Generating image with ${model.name}...`);
    
    const r = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hein1.onrender.com',
        'X-Title': 'Hein AI'
      },
      body: JSON.stringify({
        model: model.name,
        prompt: prompt,
        response_format: 'url',
        width: model.width,
        height: model.height,
        steps: model.steps,
        guidance_scale: model.guidance_scale
      }),
      signal: ctrl.signal
    });
    
    clearTimeout(to);
    const dt = Date.now() - t0;
    
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      console.log(`   ❌ Image generation failed (${r.status}) in ${dt}ms`);
      throw new Error(`Image generation failed with status ${r.status}`);
    }
    
    const data = await r.json();
    const imageUrl = data.data?.[0]?.url;
    
    if (!imageUrl) {
      console.log(`   ❌ No image URL returned`);
      throw new Error('No image URL returned');
    }
    
    console.log(`   ✅ Image generated in ${dt}ms`);
    return { imageUrl, model: model.name, responseTime: dt };
    
  } catch (e) {
    clearTimeout(to);
    const dt = Date.now() - t0;
    
    if (e.name === 'AbortError') {
      console.log(`   ⏱️  Image generation timeout after ${dt}ms`);
      throw new Error('Image generation timed out');
    } else {
      console.log(`   ❌ Image generation error: ${e.message}`);
      throw e;
    }
  }
}

async function generateImageWithOpenAI(prompt, model) {
  // This would require an OpenAI API key
  // Implementation depends on your OpenAI setup
  throw new Error('OpenAI image generation not implemented');
}

// Fallback to Pollinations if primary APIs fail
async function generateImageWithPollinations(prompt) {
  console.log('🎨 Using fallback Pollinations API...');
  const eqp = encodeURIComponent(prompt);
  const iurl = `https://image.pollinations.ai/prompt/${eqp}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;

  const ir = await fetch(iurl, { method: 'GET', headers: { 'Accept': 'image/*' } });
  if (!ir.ok) throw new Error('Pollinations image generation failed');

  const ct = ir.headers.get('content-type');
  if (!ct || !ct.startsWith('image/')) throw new Error('Invalid image response');

  return { imageUrl: iurl, model: 'Pollinations', responseTime: 0 };
}

// ==================== MIDDLEWARE ====================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "http:"]
    }
  }
}));

app.set('trust proxy', 1);

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many auth attempts' }, skipSuccessfulRequests: true });
const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: { error: 'Too many image requests' } });

const allowedOrigins = ['https://hein1.onrender.com', 'https://test-d9o3.onrender.com', ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000', 'http://localhost:5173'] : [])];

app.use(cors({ origin: (o, cb) => (!o || allowedOrigins.includes(o)) ? cb(null, true) : cb(new Error('CORS')), credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'test', 'frontend', 'dist'), { maxAge: '1d' }));
app.use(generalLimiter);

function sanitizeInput(i) {
  if (typeof i !== 'string') return i;
  return xss(i.trim(), { whiteList: { a: ['href'], img: ['src', 'alt'], b: [], strong: [], i: [], em: [], code: [], pre: [], ul: [], ol: [], li: [], p: [], br: [] }, stripIgnoreTag: true });
}

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  // Check cache first
  try {
    const decoded = jwt.verify(token, jwtSecret);
    const cachedUser = getCachedUser(decoded.id);
    if (cachedUser) {
      req.user = cachedUser;
      return next();
    }
  } catch (e) {
    // Token is invalid, continue with normal verification
  }
  
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    // Cache the user session
    cacheUser(user.id, user);
    next();
  });
}

// ==================== DATABASE HELPERS ====================
async function getUserById(userId) {
  // Check cache first
  const cachedUser = getCachedUser(userId);
  if (cachedUser) return cachedUser;
  
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    
    if (error || !data) return null;
    
    // Cache the user
    cacheUser(userId, data);
    return data;
  } catch (e) {
    console.error('Error fetching user:', e);
    return null;
  }
}

async function createChat(userId, title) {
  try {
    const { data, error } = await supabase
      .from('chats')
      .insert([{ user_id: userId, title: title.substring(0, 50) }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('Error creating chat:', e);
    throw e;
  }
}

async function getChatById(chatId, userId) {
  try {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error || !data) return null;
    return data;
  } catch (e) {
    console.error('Error fetching chat:', e);
    return null;
  }
}

async function addMessage(chatId, role, content) {
  try {
    // Ensure chatId is a string, not an object
    const id = typeof chatId === 'string' ? chatId : chatId.id;
    
    const { data, error } = await supabase
      .from('messages')
      .insert([{
        chat_id: id,
        role,
        content: sanitizeInput(content),
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('Error adding message:', e);
    throw e;
  }
}

async function updateChatLastMessage(chatId, lastMessage) {
  try {
    // Ensure chatId is a string, not an object
    const id = typeof chatId === 'string' ? chatId : chatId.id;
    
    const { error } = await supabase
      .from('chats')
      .update({
        last_message: sanitizeInput(lastMessage).substring(0, 100),
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Error updating chat:', e);
    return false;
  }
}

// ==================== ROUTES ====================
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    version: '5.1', 
    strategy: 'Multi-API with Comma-Separated Keys & Enhanced Caching', 
    features: [
      'Comma-separated API keys for both Gemini and OpenRouter',
      'Gemini-2.0-Flash as primary model',
      'GLM-4.5-Air as fallback model',
      'Improved DuckDuckGo search',
      'Enhanced Image Generation with caching',
      'LRU caching for better performance',
      'Optimized database operations'
    ] 
  });
});

app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    res.json({ status: 'OK', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'ERROR' });
  }
});

app.get('/api/model-stats', (req, res) => {
  const stats = {};
  for (const [id, d] of modelStats.entries()) {
    const tot = d.successCount + d.failCount;
    const model = id === AI_MODEL.id ? AI_MODEL : FALLBACK_MODEL;
    stats[model.name] = {
      successRate: tot > 0 ? ((d.successCount / tot) * 100).toFixed(1) + '%' : 'N/A',
      totalCalls: tot,
      rateLimits: d.rateLimitCount
    };
  }
  res.json({ 
    stats, 
    strategy: 'Comma-separated API keys for both Gemini and OpenRouter',
    geminiKeys: geminiKeys.length,
    openRouterKeys: openRouterKeys.length,
    imageCacheSize: imageCache.size,
    searchCacheSize: searchCache.size,
    promptCacheSize: promptCache.size,
    userCacheSize: userCache.size
  });
});

app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });
    const e = sanitizeInput(email).toLowerCase();
    const n = sanitizeInput(name);
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
    const { data: ex } = await supabase.from('users').select('id').eq('email', e).maybeSingle();
    if (ex) return res.status(400).json({ error: 'Email exists' });
    const h = await bcrypt.hash(password, 10);
    const { data: u, error } = await supabase.from('users').insert([{ email: e, password: h, name: n }]).select().single();
    if (error) return res.status(500).json({ error: 'Registration failed' });
    const token = jwt.sign({ id: u.id, email: u.email }, jwtSecret, { expiresIn: '7d' });
    
    // Cache the user
    cacheUser(u.id, { id: u.id, email: u.email, name: u.name });
    
    res.status(201).json({ token, user: { id: u.id, email: u.email, name: u.name } });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });
    const e = sanitizeInput(email).toLowerCase();
    const { data: u, error } = await supabase.from('users').select('*').eq('email', e).maybeSingle();
    if (error || !u) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, u.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: u.id, email: u.email }, jwtSecret, { expiresIn: '7d' });
    
    // Cache the user
    cacheUser(u.id, { id: u.id, email: u.email, name: u.name });
    
    res.json({ token, user: { id: u.id, email: u.email, name: u.name } });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { messages, chatId, prompt } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });
    
    const uid = req.user.id;
    let cid = chatId;

    if (!cid) {
      const fm = sanitizeInput(prompt || messages[0]?.content || 'New chat');
      cid = await createChat(uid, fm);
    } else {
      const c = await getChatById(cid, uid);
      if (!c) return res.status(404).json({ error: 'Chat not found' });
      cid = c.id;
    }

    const uc = prompt ? sanitizeInput(prompt) : sanitizeInput(messages.filter(m => m.role === 'user').pop()?.content || '');
    if (!uc) return res.status(400).json({ error: 'No message' });

    await addMessage(cid, 'user', uc);

    const t0 = Date.now();
    let msg = '', model = '', modelName = '', isSearch = false, srcs = [];

    // Check for explicit search keywords first
    const hasExplicitKeyword = hasExplicitSearchKeyword(uc);
    
    if (hasExplicitKeyword) {
      // Remove keyword prefix
      const kw = ['tìm kiếm:', 'search:', 'tra cứu:', 'google:', 'tìm:', 'find:', 'lookup:'];
      let q = uc;
      for (const k of kw) {
        if (uc.toLowerCase().startsWith(k.toLowerCase())) {
          q = uc.substring(k.length).trim();
          break;
        }
      }
      
      isSearch = true;
      console.log(`\n🔍 Explicit search: "${q}"`);
      const searchData = await smartSearch(q);
      
      if (searchData.totalSources > 0) {
        srcs = searchData.suggestedSites.slice(0, 5);
        msg = await summarizeSearchResults(q, searchData);
        modelName = 'Smart Search';
        model = 'enhanced-search';
      } else {
        msg = 'Không tìm thấy thông tin phù hợp.';
        modelName = 'Search';
      }
    } else {
      // Check if should search (using improved detection)
      const doSearch = await shouldSearchWeb(uc);
      
      if (doSearch) {
        isSearch = true;
        console.log(`\n🔍 Auto search: "${uc}"`);
        const searchData = await smartSearch(uc);
        
        if (searchData.totalSources > 0) {
          srcs = searchData.suggestedSites.slice(0, 5);
          msg = await summarizeSearchResults(uc, searchData);
          modelName = 'Smart Search';
          model = 'enhanced-search';
        } else {
          msg = 'Không tìm thấy thông tin phù hợp.';
          modelName = 'Search';
        }
      } else {
        // Regular chat
        console.log(`\n💬 Chat mode: "${uc.substring(0, 50)}..."`);
        const mm = messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: sanitizeInput(m.content) }));
        const sys = { role: 'system', content: 'You are Hein, an AI assistant by Hien2309. Answer in user\'s language. Be accurate, concise, helpful.' };
        try {
          const r = await callAISingleModel([sys, ...mm], 'chat', { temperature: 0.7, maxTokens: 500 });
          msg = r.content;
          model = r.modelId;
          modelName = r.modelName;
        } catch {
          return res.status(500).json({ error: 'AI unavailable' });
        }
      }
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    msg += isSearch ? `\n\n*${dt}s | ${srcs.length} sources*` : `\n\n*${modelName} | ${dt}s*`;

    const sm = await addMessage(cid, 'ai', msg);
    await updateChatLastMessage(cid, uc);

    res.json({ message: msg, messageId: sm.id, chatId: cid, timestamp: sm.timestamp, isWebSearch: isSearch, usedModel: modelName });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Optimized image generation endpoint
app.post('/api/generate-image', authenticateToken, imageLimiter, async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'Invalid prompt' });
    if (prompt.length > 500) return res.status(400).json({ error: 'Prompt too long' });

    const sp = sanitizeInput(prompt);
    const uid = req.user.id;
    let cid = chatId;

    // Check cache first
    const cachedImage = getCachedImage(sp);
    if (cachedImage) {
      console.log('🎨 Using cached image');
      
      // Create chat if needed
      if (!cid) {
        cid = await createChat(uid, `Image: ${sp.substring(0, 40)}`);
      } else {
        const c = await getChatById(cid, uid);
        if (!c) return res.status(404).json({ error: 'Chat not found' });
      }

      await addMessage(cid, 'user', sp);
      
      const mc = `![Image](${cachedImage.url})\n\n**Prompt:** ${sp}\n\n*Cached image*`;
      
      const sm = await addMessage(cid, 'ai', mc);
      await updateChatLastMessage(cid, `Image: ${sp.substring(0, 50)}`);

      return res.json({ 
        message: mc, 
        imageUrl: cachedImage.url, 
        originalPrompt: sp,
        messageId: sm.id, 
        chatId: cid, 
        timestamp: sm.timestamp,
        cached: true
      });
    }

    // Create chat if needed
    if (!cid) {
      cid = await createChat(uid, `Image: ${sp.substring(0, 40)}`);
    } else {
      const c = await getChatById(cid, uid);
      if (!c) return res.status(404).json({ error: 'Chat not found' });
    }

    await addMessage(cid, 'user', sp);

    const t0 = Date.now();
    
    // Step 1: Translate to English if needed
    console.log('🌐 Translating prompt to English...');
    const translatedPrompt = await translateToEnglish(sp);
    
    // Step 2: Generate detailed prompt
    console.log('🎨 Generating detailed image prompt...');
    const detailedPrompt = await generateDetailedImagePrompt(translatedPrompt);
    
    // Step 3: Generate image with primary API
    let imageResult;
    try {
      imageResult = await generateImageWithAPI(detailedPrompt, IMAGE_MODELS.primary);
    } catch (e) {
      console.log(`Primary image API failed: ${e.message}`);
      try {
        // Try fallback API
        imageResult = await generateImageWithAPI(detailedPrompt, IMAGE_MODELS.fallback);
      } catch (e2) {
        console.log(`Fallback image API failed: ${e2.message}`);
        // Use Pollinations as last resort
        imageResult = await generateImageWithPollinations(detailedPrompt);
      }
    }
    
    // Step 4: Store image in Supabase
    let furl = imageResult.imageUrl;
    
    // If the URL is from Pollinations, we need to fetch and store the image
    if (imageResult.model === 'Pollinations') {
      const ir = await fetch(imageResult.imageUrl, { method: 'GET', headers: { 'Accept': 'image/*' } });
      if (!ir.ok) return res.status(500).json({ error: 'Image generation failed' });

      const ct = ir.headers.get('content-type');
      if (!ct || !ct.startsWith('image/')) return res.status(500).json({ error: 'Invalid image response' });

      const buf = await ir.buffer();
      const iid = uuidv4();

      const { error: se } = await supabase.storage.from('images').upload(`public/${iid}.png`, buf, { contentType: ct, upsert: true });
      if (!se) {
        const { data: sd } = await supabase.storage.from('images').createSignedUrl(`public/${iid}.png`, 86400);
        if (sd?.signedUrl) furl = sd.signedUrl;
      }
    }
    
    // Cache the image
    cacheImage(sp, furl);
    
    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    
    // Create detailed message with all steps
    const mc = `![Image](${furl})\n\n**Original Prompt:** ${sp}\n**Translated:** ${translatedPrompt}\n**Enhanced:** ${detailedPrompt}\n\n*Generated with ${imageResult.model} in ${dt}s*`;

    const sm = await addMessage(cid, 'ai', mc);
    await updateChatLastMessage(cid, `Image: ${sp.substring(0, 50)}`);

    res.json({ 
      message: mc, 
      imageUrl: furl, 
      originalPrompt: sp,
      translatedPrompt: translatedPrompt,
      enhancedPrompt: detailedPrompt,
      messageId: sm.id, 
      chatId: cid, 
      timestamp: sm.timestamp,
      model: imageResult.model,
      cached: false
    });
  } catch (e) {
    console.error('Image generation error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/chat/history', authenticateToken, async (req, res) => {
  try {
    const uid = req.user.id;
    const pg = Math.max(1, parseInt(req.query.page) || 1);
    const lim = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 50);
    const off = (pg - 1) * lim;

    const { data: chats, error } = await supabase.from('chats').select('id, title, last_message, created_at, updated_at').eq('user_id', uid).order('updated_at', { ascending: false }).range(off, off + lim - 1);
    if (error) return res.status(500).json({ error: 'Failed to fetch history' });

    const hist = await Promise.all(chats.map(async c => {
      const { data: msgs } = await supabase.from('messages').select('id, role, content, timestamp').eq('chat_id', c.id).order('timestamp', { ascending: true }).limit(100);
      return { ...c, messages: msgs || [] };
    }));

    res.json({ history: hist, page: pg, limit: lim });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const uid = req.user.id;
    if (!validate(chatId)) return res.status(400).json({ error: 'Invalid chat ID' });
    const c = await getChatById(chatId, uid);
    if (!c) return res.status(404).json({ error: 'Chat not found' });
    await supabase.from('messages').delete().eq('chat_id', chatId);
    await supabase.from('chats').delete().eq('id', chatId).eq('user_id', uid);
    res.json({ message: 'Chat deleted', chatId });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const uid = req.user.id;
    if (!validate(messageId)) return res.status(400).json({ error: 'Invalid message ID' });
    const { data: m, error: me } = await supabase.from('messages').select('chat_id').eq('id', messageId).maybeSingle();
    if (me || !m) return res.status(404).json({ error: 'Message not found' });
    const c = await getChatById(m.chat_id, uid);
    if (!c) return res.status(404).json({ error: 'Chat not found' });
    const { error: de } = await supabase.from('messages').delete().eq('id', messageId);
    if (de) return res.status(500).json({ error: 'Failed to delete' });
    const { data: lm } = await supabase.from('messages').select('content').eq('chat_id', m.chat_id).order('timestamp', { ascending: false }).limit(1).maybeSingle();
    if (lm) await updateChatLastMessage(m.chat_id, lm.content);
    res.json({ message: 'Message deleted', messageId });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  const idx = path.join(__dirname, 'test', 'frontend', 'dist', 'index.html');
  res.sendFile(idx, err => { if (err) res.status(500).json({ error: 'Failed to serve' }); });
});

app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  if (err.message === 'CORS') return res.status(403).json({ error: 'CORS error' });
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== SERVER START ====================
const server = app.listen(process.env.PORT || 3001, () => {
  console.log('========================================');
  console.log(`Server running on port ${process.env.PORT || 3001}`);
  console.log('========================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('\n🚀 MULTI-API v5.1 - OPTIMIZED');
  console.log('   ✓ Comma-separated API keys for both Gemini and OpenRouter');
  console.log('   ✓ Gemini-2.0-Flash as primary model (15 RPM, 1M TPM)');
  console.log('   ✓ GLM-4.5-Air as fallback model');
  console.log('   ✓ Improved DuckDuckGo search with multiple sources');
  console.log('   ✓ Enhanced image generation with caching');
  console.log('   ✓ LRU caching for better performance');
  console.log('   ✓ Optimized database operations');
  console.log('\n🎯 Detection Logic:');
  console.log('   • Explicit: "tìm kiếm:", "search:"');
  console.log('   • Products: Dell 5420, iPhone 15, etc.');
  console.log('   • Real-time: news, weather, prices');
  console.log('   • Specific facts: CEO of X, price of Y');
  console.log('   • DEFAULT: Chat mode (no search)');
  console.log('\n🔍 Search Strategy:');
  console.log('   • DuckDuckGo: Primary search source');
  console.log('   • Wikipedia: Secondary search source');
  console.log('   • Site-specific: Targeted searches');
  console.log('   • Search result caching for faster responses');
  console.log('\n🎨 Image Generation:');
  console.log('   • Vietnamese to English translation');
  console.log('   • Detailed prompt enhancement');
  console.log('   • Art style, lighting, composition details');
  console.log('   • Image caching for performance');
  console.log('   • Multiple API fallbacks');
  console.log('\n📊 Models:');
  console.log(`   Primary: ${AI_MODEL.name} (15 RPM, 1M TPM, 200 RPD)`);
  console.log(`   Fallback: ${FALLBACK_MODEL.name}`);
  console.log(`   Gemini Keys: ${geminiKeys.length}`);
  console.log(`   OpenRouter Keys: ${openRouterKeys.length}`);
  console.log('\n🔒 Security: Rate limiting + Helmet + CORS');
  console.log('========================================\n');
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => { console.log('Server closed'); process.exit(0); });
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => { console.log('Server closed'); process.exit(0); });
});
