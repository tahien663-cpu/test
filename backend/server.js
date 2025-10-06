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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'JWT_SECRET'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openRouterKey = process.env.OPENROUTER_API_KEY;
const jwtSecret = process.env.JWT_SECRET;

// STRATEGY: Dùng 1 model cho mỗi category, fallback chỉ khi thất bại
const AI_MODELS = {
  chat: [
    { id: 'deepseek/deepseek-chat-v3.1:free', timeout: 60000, name: 'DeepSeek' },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 60000, name: 'Gemini' },
    { id: 'qwen/qwen3-4b:free', timeout: 60000, name: 'Qwen' },
    { id: 'meta-llama/llama-3.3-8b-instruct:free', timeout: 60000, name: 'Llama' }
  ],
  quick: [
    { id: 'qwen/qwen3-4b:free', timeout: 60000, name: 'Qwen' },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 60000, name: 'Gemini' },
    { id: 'deepseek/deepseek-chat-v3.1:free', timeout: 60000, name: 'DeepSeek' }
  ],
  research: [
    { id: 'alibaba/tongyi-deepresearch-30b-a3b:free', timeout: 60000, name: 'DeepResearch' },
    { id: 'deepseek/deepseek-chat-v3.1:free', timeout: 60000, name: 'DeepSeek' },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 60000, name: 'Gemini' }
  ]
};

const modelStats = new Map();
const rateLimitTracker = new Map();

function initModelStats() {
  for (const cat in AI_MODELS) {
    AI_MODELS[cat].forEach(m => {
      modelStats.set(m.id, { successCount: 0, failCount: 0, lastUsed: null, rateLimitCount: 0 });
      rateLimitTracker.set(m.id, { isRateLimited: false, rateLimitUntil: null });
    });
  }
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

// CORE: Chỉ dùng 1 model tại 1 thời điểm, fallback chỉ khi thất bại
async function callAISingleModel(msgs, cat = 'chat', opts = {}) {
  const models = AI_MODELS[cat] || AI_MODELS.chat;
  const { temperature = 0.7, maxTokens = 500 } = opts;
  
  for (const model of models) {
    if (isModelRateLimited(model.id)) {
      console.log(`⏭️  Skip ${model.name} (rate limited)`);
      continue;
    }
    
    const t0 = Date.now();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), model.timeout);
    
    try {
      console.log(`🤖 Using ${model.name}... (timeout: ${model.timeout/1000}s)`);
      
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein1.onrender.com',
          'X-Title': 'Hein AI'
        },
        body: JSON.stringify({ model: model.id, messages: msgs, temperature, max_tokens: maxTokens }),
        signal: ctrl.signal
      });
      
      clearTimeout(to);
      const dt = Date.now() - t0;
      
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.log(`   ❌ ${model.name} failed (${r.status}) in ${dt}ms`);
        
        if (r.status === 429 || err.toLowerCase().includes('rate limit')) {
          const retrySecs = parseRetryAfter(err);
          markModelRateLimited(model.id, retrySecs);
        }
        
        updateModelStats(model.id, false);
        continue;
      }
      
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        console.log(`   ❌ ${model.name} returned empty content`);
        updateModelStats(model.id, false);
        continue;
      }
      
      console.log(`   ✅ ${model.name} succeeded in ${dt}ms`);
      updateModelStats(model.id, true);
      
      return { content, modelId: model.id, modelName: model.name, responseTime: dt };
      
    } catch (e) {
      clearTimeout(to);
      const dt = Date.now() - t0;
      
      if (e.name === 'AbortError') {
        console.log(`   ⏱️  ${model.name} timeout after ${dt}ms`);
      } else {
        console.log(`   ❌ ${model.name} error: ${e.message}`);
      }
      
      updateModelStats(model.id, false);
      continue;
    }
  }
  
  throw new Error('All models failed');
}

async function enhancePrompt(txt, isImg = false) {
  try {
    const sys = isImg 
      ? 'Translate to English, add artistic details. Max 70 chars, no punctuation. Only return prompt.' 
      : 'Enhance prompt to be clearer. Max 200 chars. Only return enhanced prompt.';
    
    const r = await callAISingleModel([
      { role: 'system', content: sys },
      { role: 'user', content: `Enhance: "${txt}"` }
    ], 'quick', { maxTokens: isImg ? 100 : 200 });
    
    const e = r.content.trim() || txt;
    const max = isImg ? 200 : 500;
    return e.length > max ? e.substring(0, max - 3) + '...' : e;
  } catch {
    return txt;
  }
}

// ========== IMPROVED SEARCH DETECTION ==========

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
  
  return productPatterns.some(p => p.test(msg));
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
  
  return realTimeIndicators.some(p => p.test(msg));
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
  
  return specificFactual.some(p => p.test(msg));
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
  
  return noSearchPatterns.some(p => p.test(msg));
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

// ========== SEARCH FUNCTIONS ==========

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
  const queryType = detectQueryType(query);
  console.log(`   Type: ${queryType}`);
  
  try {
    console.log('📍 Step 1: Suggesting websites...');
    const suggestedSites = await suggestWebsites(query);
    console.log(`   Found ${suggestedSites.length} sites`);
    
    if (suggestedSites.length === 0) return await searchWebFallback(query);
    
    console.log('🔎 Step 2: Searching sites...');
    const searchResults = await searchSpecificSites(query, suggestedSites);
    console.log(`   Found ${searchResults.length} results`);
    
    console.log('📥 Step 3: Crawling...');
    let topUrls = [...new Set(searchResults.map(r => r.link))].slice(0, 5);
    
    if (topUrls.length === 0) {
      console.log('   No results, crawling suggested sites');
      topUrls = suggestedSites.slice(0, 5);
    }
    
    if (topUrls.length === 0) return await searchWebFallback(query);
    
    const crawlPromises = topUrls.map(url => crawlWebpage(url));
    const crawledData = (await Promise.all(crawlPromises)).filter(d => d !== null);
    console.log(`   Crawled ${crawledData.length}/${topUrls.length} pages`);
    
    if (crawledData.length > 0 || searchResults.length > 0) {
      return {
        query,
        queryType,
        suggestedSites,
        searchResults,
        crawledData,
        totalSources: crawledData.length + searchResults.length
      };
    }
    
    return await searchWebFallback(query);
  } catch (e) {
    console.error('   Error:', e.message);
    return await searchWebFallback(query);
  }
}

async function searchWebFallback(query) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  
  try {
    const eq = encodeURIComponent(query);
    
    const searches = [
      fetch(`https://api.duckduckgo.com/?q=${eq}&format=json&no_html=1`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
        .then(r => r.json())
        .then(d => {
          const res = [];
          if (d.Abstract) res.push({ title: d.Heading || 'Answer', snippet: d.Abstract, link: d.AbstractURL || '', source: 'DuckDuckGo', priority: 10 });
          if (d.RelatedTopics) {
            d.RelatedTopics.slice(0, 5).forEach(t => {
              if (t.Text && t.FirstURL) {
                const dom = new URL(t.FirstURL).hostname;
                res.push({ title: t.Text.split(' - ')[0], snippet: t.Text, link: t.FirstURL, source: dom, priority: 5 });
              }
            });
          }
          return res;
        })
        .catch(() => []),
      
      fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${eq}&format=json&srlimit=3&origin=*`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(d => (d.query?.search || []).map(i => ({
          title: i.title,
          snippet: i.snippet.replace(/<[^>]*>/g, ''),
          link: `https://en.wikipedia.org/wiki/${encodeURIComponent(i.title.replace(/ /g, '_'))}`,
          source: 'wikipedia.org',
          priority: 9
        })))
        .catch(() => [])
    ];

    const settled = await Promise.allSettled(searches.map(p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))])));
    const res = settled.filter(r => r.status === 'fulfilled' && Array.isArray(r.value)).flatMap(r => r.value);
    
    clearTimeout(to);
    
    return { query, queryType: 'general', suggestedSites: [], searchResults: res, crawledData: [], totalSources: res.length };
  } catch {
    clearTimeout(to);
    return { query, queryType: 'general', suggestedSites: [], searchResults: [], crawledData: [], totalSources: 0 };
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

async function verifyImage(url) {
  await new Promise(r => setTimeout(r, 2000));
  for (let i = 1; i <= 3; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 2000);
      const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok && r.headers.get('content-type')?.startsWith('image/')) return { success: true, attempts: i };
    } catch { }
    if (i < 3) await new Promise(r => setTimeout(r, 800));
  }
  return { success: false, attempts: 3 };
}

// ========== MIDDLEWARE ==========

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
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ========== ROUTES ==========

app.get('/', (req, res) => {
  res.json({ status: 'OK', version: '4.4', strategy: 'Smart Search Detection', features: ['Improved Detection', 'No False Positives', 'Product Detection', 'Real-time Queries'] });
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
    const model = Object.values(AI_MODELS).flat().find(m => m.id === id);
    stats[model?.name || id] = {
      successRate: tot > 0 ? ((d.successCount / tot) * 100).toFixed(1) + '%' : 'N/A',
      totalCalls: tot,
      rateLimits: d.rateLimitCount
    };
  }
  res.json({ stats, strategy: 'Smart search detection with no false positives' });
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
      const { data: c, error } = await supabase.from('chats').insert([{ user_id: uid, title: fm.substring(0, 50) }]).select().single();
      if (error) return res.status(500).json({ error: 'Failed to create chat' });
      cid = c.id;
    } else {
      const { data: c } = await supabase.from('chats').select('id').eq('id', cid).eq('user_id', uid).maybeSingle();
      if (!c) return res.status(404).json({ error: 'Chat not found' });
      cid = c.id;
    }

    const uc = prompt ? sanitizeInput(prompt) : sanitizeInput(messages.filter(m => m.role === 'user').pop()?.content || '');
    if (!uc) return res.status(400).json({ error: 'No message' });

    await supabase.from('messages').insert([{ chat_id: cid, role: 'user', content: uc, timestamp: new Date().toISOString() }]);

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

    const { data: sm, error: me } = await supabase.from('messages').insert([{ chat_id: cid, role: 'ai', content: sanitizeInput(msg), timestamp: new Date().toISOString() }]).select().single();
    if (me) return res.status(500).json({ error: 'Failed to save' });

    await supabase.from('chats').update({ last_message: sanitizeInput(uc).substring(0, 100), updated_at: new Date().toISOString() }).eq('id', cid);

    res.json({ message: msg, messageId: sm.id, chatId: cid, timestamp: sm.timestamp, isWebSearch: isSearch, usedModel: modelName });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/generate-image', authenticateToken, imageLimiter, async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'Invalid prompt' });
    if (prompt.length > 500) return res.status(400).json({ error: 'Prompt too long' });

    const sp = sanitizeInput(prompt);
    const uid = req.user.id;
    let cid = chatId;

    if (!cid) {
      const { data: c, error } = await supabase.from('chats').insert([{ user_id: uid, title: `Image: ${sp.substring(0, 40)}` }]).select().single();
      if (error) return res.status(500).json({ error: 'Failed to create chat' });
      cid = c.id;
    } else {
      const { data: c } = await supabase.from('chats').select('id').eq('id', cid).eq('user_id', uid).maybeSingle();
      if (!c) return res.status(404).json({ error: 'Chat not found' });
      cid = c.id;
    }

    await supabase.from('messages').insert([{ chat_id: cid, role: 'user', content: sp, timestamp: new Date().toISOString() }]);

    const t0 = Date.now();
    const ep = await enhancePrompt(sp, true);
    const eqp = encodeURIComponent(ep);
    const iurl = `https://image.pollinations.ai/prompt/${eqp}?width=1024&height=1024&nologo=true`;

    const ir = await fetch(iurl, { method: 'GET', headers: { 'Accept': 'image/*' } });
    if (!ir.ok) return res.status(500).json({ error: 'Image generation failed' });

    const ct = ir.headers.get('content-type');
    if (!ct || !ct.startsWith('image/')) return res.status(500).json({ error: 'Invalid image response' });

    const buf = await ir.buffer();
    const iid = uuidv4();
    let furl = iurl;

    const { error: se } = await supabase.storage.from('images').upload(`public/${iid}.png`, buf, { contentType: ct, upsert: true });
    if (!se) {
      const { data: sd } = await supabase.storage.from('images').createSignedUrl(`public/${iid}.png`, 86400);
      if (sd?.signedUrl) furl = sd.signedUrl;
    }

    const v = await verifyImage(furl);
    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    const mc = `![Image](${furl})\n\n*Enhanced: ${ep}*\n*${dt}s ${v.success ? '(verified)' : ''}*`;

    const { data: sm, error: me } = await supabase.from('messages').insert([{ chat_id: cid, role: 'ai', content: mc, timestamp: new Date().toISOString() }]).select().single();
    if (me) return res.status(500).json({ error: 'Failed to save' });

    await supabase.from('chats').update({ last_message: `Image: ${sp.substring(0, 50)}`, updated_at: new Date().toISOString() }).eq('id', cid);

    res.json({ message: mc, imageUrl: furl, enhancedPrompt: ep, messageId: sm.id, chatId: cid, timestamp: sm.timestamp });
  } catch {
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
    const { data: c } = await supabase.from('chats').select('id').eq('id', chatId).eq('user_id', uid).maybeSingle();
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
    const { data: c, error: ce } = await supabase.from('chats').select('id').eq('id', m.chat_id).eq('user_id', uid).maybeSingle();
    if (ce || !c) return res.status(404).json({ error: 'Chat not found' });
    const { error: de } = await supabase.from('messages').delete().eq('id', messageId);
    if (de) return res.status(500).json({ error: 'Failed to delete' });
    const { data: lm } = await supabase.from('messages').select('content').eq('chat_id', m.chat_id).order('timestamp', { ascending: false }).limit(1).maybeSingle();
    if (lm) await supabase.from('chats').update({ last_message: sanitizeInput(lm.content).substring(0, 100), updated_at: new Date().toISOString() }).eq('id', m.chat_id);
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

const server = app.listen(process.env.PORT || 3001, () => {
  console.log('========================================');
  console.log(`Server running on port ${process.env.PORT || 3001}`);
  console.log('========================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('\n🚀 SMART SEARCH DETECTION v4.4');
  console.log('   ✓ Improved search vs chat detection');
  console.log('   ✓ No false positives for coding/knowledge');
  console.log('   ✓ Product-specific queries auto-detected');
  console.log('   ✓ Real-time/news queries auto-detected');
  console.log('   ✓ Explicit keywords supported');
  console.log('\n🎯 Detection Logic:');
  console.log('   • Explicit: "tìm kiếm:", "search:"');
  console.log('   • Products: Dell 5420, iPhone 15, etc.');
  console.log('   • Real-time: news, weather, prices');
  console.log('   • Specific facts: CEO of X, price of Y');
  console.log('   • DEFAULT: Chat mode (no search)');
  console.log('\n📊 Model Order:');
  console.log('   Chat: DeepSeek → Gemini → Qwen → Llama');
  console.log('   Quick: Qwen → Gemini → DeepSeek');
  console.log('   Research: DeepResearch → DeepSeek → Gemini');
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
