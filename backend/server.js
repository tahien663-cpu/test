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

// DeepSeek luôn đầu tiên, timeout 60s
const AI_MODELS = {
  chat: [
    { id: 'deepseek/deepseek-chat-v3.1:free', timeout: 60000 },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 8000 },
    { id: 'qwen/qwen3-4b:free', timeout: 8000 },
    { id: 'meta-llama/llama-3.3-8b-instruct:free', timeout: 12000 }
  ],
  quick: [
    { id: 'qwen/qwen3-4b:free', timeout: 6000 },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 7000 }
  ],
  research: [{ id: 'alibaba/tongyi-deepresearch-30b-a3b:free', timeout: 20000 }]
};

const modelStats = new Map();
const rateLimitTracker = new Map();

function initModelStats() {
  for (const cat in AI_MODELS) {
    AI_MODELS[cat].forEach(m => {
      modelStats.set(m.id, { successCount: 0, failCount: 0, avgResponseTime: 0, lastUsed: null });
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

function markModelRateLimited(id, secs) {
  const t = rateLimitTracker.get(id) || {};
  t.isRateLimited = true;
  t.rateLimitUntil = Date.now() + secs * 1000;
  rateLimitTracker.set(id, t);
}

function parseRetryAfter(msg) {
  const m = msg.match(/(\d+) seconds/i);
  return m ? parseInt(m[1]) : 60;
}

function updateModelStats(id, ok, time) {
  const s = modelStats.get(id);
  if (!s) return;
  if (ok) {
    s.successCount++;
    s.avgResponseTime = s.avgResponseTime === 0 ? time : s.avgResponseTime * 0.7 + time * 0.3;
  } else s.failCount++;
  s.lastUsed = Date.now();
  modelStats.set(id, s);
}

function getSortedModels(cat) {
  const ms = AI_MODELS[cat] || AI_MODELS.chat;
  const avail = ms.filter(m => !isModelRateLimited(m.id));
  if (!avail.length) return ms;
  return avail;
}

async function callAISequential(msgs, cat = 'chat', opts = {}) {
  const ms = getSortedModels(cat);
  const { temperature = 0.7, maxTokens = 500 } = opts;
  
  for (const m of ms) {
    if (isModelRateLimited(m.id)) continue;
    const t0 = Date.now();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), m.timeout);
    
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein1.onrender.com',
          'X-Title': 'Hein AI'
        },
        body: JSON.stringify({ model: m.id, messages: msgs, temperature, max_tokens: maxTokens }),
        signal: ctrl.signal
      });
      
      clearTimeout(to);
      const dt = Date.now() - t0;
      
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        if (r.status === 429 || err.includes('rate limit')) {
          markModelRateLimited(m.id, parseRetryAfter(err));
          updateModelStats(m.id, false, dt);
          continue;
        }
        updateModelStats(m.id, false, dt);
        continue;
      }
      
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        updateModelStats(m.id, false, dt);
        continue;
      }
      
      updateModelStats(m.id, true, dt);
      return { content, modelId: m.id, responseTime: dt };
    } catch (e) {
      clearTimeout(to);
      if (e.name !== 'AbortError') updateModelStats(m.id, false, Date.now() - t0);
      continue;
    }
  }
  throw new Error('All models failed');
}

async function callAIRacing(msgs, cat = 'chat', opts = {}) {
  return callAISequential(msgs, cat, opts);
}

async function enhancePrompt(txt, isImg = false) {
  try {
    const sys = isImg ? 'Translate to English, add artistic details. Max 70 chars, no punctuation. Only return prompt.' : 'Enhance prompt to be clearer. Max 200 chars. Only return enhanced prompt.';
    const r = await callAISequential([{ role: 'system', content: sys }, { role: 'user', content: `Enhance: "${txt}"` }], 'quick', { maxTokens: isImg ? 100 : 200 });
    const e = r.content.trim() || txt;
    const max = isImg ? 200 : 500;
    return e.length > max ? e.substring(0, max - 3) + '...' : e;
  } catch {
    return txt;
  }
}

// BƯỚC 1: Hỏi AI nên tìm ở đâu
async function suggestWebsites(query) {
  try {
    const r = await callAISequential([
      { 
        role: 'system', 
        content: `You are a search expert. Suggest 3-5 best websites to find information about the query. 
Format: JSON array only, no explanation.
Example: ["https://www.apple.com", "https://www.gsmarena.com", "https://www.theverge.com"]
Prioritize: official sites, tech review sites, news sites, wikipedia.
For Vietnamese queries, include Vietnamese sites like vnexpress.net, tinhte.vn, etc.`
      },
      { role: 'user', content: `Best websites to search for: "${query}"` }
    ], 'quick', { temperature: 0.3, maxTokens: 200 });
    
    const content = r.content.trim();
    const jsonMatch = content.match(/\[.*?\]/s);
    if (!jsonMatch) return [];
    
    const sites = JSON.parse(jsonMatch[0]);
    return sites.filter(s => s.startsWith('http')).slice(0, 5);
  } catch (e) {
    console.error('Error suggesting websites:', e);
    return [];
  }
}

// BƯỚC 2: Tìm kiếm trên Google/DuckDuckGo với site-specific
async function searchSpecificSites(query, sites) {
  const results = [];
  
  for (const site of sites) {
    try {
      const domain = new URL(site).hostname.replace('www.', '');
      const searchQuery = `${query} site:${domain}`;
      const eq = encodeURIComponent(searchQuery);
      
      // Tìm trên DuckDuckGo
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 8000);
      
      const r = await fetch(`https://api.duckduckgo.com/?q=${eq}&format=json&no_html=1`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      clearTimeout(timeout);
      
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
          data.RelatedTopics.slice(0, 3).forEach(t => {
            if (t.Text && t.FirstURL && t.FirstURL.includes(domain)) {
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
      }
    } catch (e) {
      console.error(`Error searching ${site}:`, e.message);
    }
  }
  
  return results;
}

// BƯỚC 3: Crawl nội dung từ các trang web
async function crawlWebpage(url) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    clearTimeout(timeout);
    
    if (!r.ok) return null;
    
    const html = await r.text();
    const $ = cheerio.load(html);
    
    // Xóa các element không cần thiết
    $('script, style, nav, header, footer, iframe, noscript').remove();
    
    // Lấy title
    const title = $('title').text().trim() || $('h1').first().text().trim();
    
    // Lấy nội dung chính
    let content = '';
    
    // Thử các selector phổ biến cho nội dung chính
    const contentSelectors = [
      'article',
      '[role="main"]',
      'main',
      '.content',
      '.article-content',
      '.post-content',
      '#content',
      '.entry-content'
    ];
    
    for (const selector of contentSelectors) {
      const elem = $(selector);
      if (elem.length > 0) {
        content = elem.text();
        break;
      }
    }
    
    // Nếu không tìm thấy, lấy body
    if (!content) {
      content = $('body').text();
    }
    
    // Làm sạch content
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
      .substring(0, 3000); // Giới hạn 3000 ký tự
    
    return { title, content, url };
  } catch (e) {
    console.error(`Error crawling ${url}:`, e.message);
    return null;
  }
}

// BƯỚC 4: Tổng hợp thông tin từ nhiều nguồn
async function smartSearch(query) {
  console.log(`\n🔍 Smart Search: "${query}"`);
  
  // Bước 1: Hỏi AI nên tìm ở đâu
  console.log('📍 Step 1: Suggesting websites...');
  const suggestedSites = await suggestWebsites(query);
  console.log(`   Found ${suggestedSites.length} suggested sites:`, suggestedSites);
  
  if (suggestedSites.length === 0) {
    // Fallback: dùng search thông thường
    return await searchWebFallback(query);
  }
  
  // Bước 2: Tìm URLs cụ thể từ các site đó
  console.log('🔎 Step 2: Searching specific sites...');
  const searchResults = await searchSpecificSites(query, suggestedSites);
  console.log(`   Found ${searchResults.length} search results`);
  
  // Bước 3: Crawl nội dung từ top URLs
  console.log('📥 Step 3: Crawling webpages...');
  const topUrls = [...new Set(searchResults.map(r => r.link))].slice(0, 3);
  const crawlPromises = topUrls.map(url => crawlWebpage(url));
  const crawledData = (await Promise.all(crawlPromises)).filter(d => d !== null);
  console.log(`   Crawled ${crawledData.length} pages successfully`);
  
  // Bước 4: Tổng hợp kết quả
  return {
    query,
    suggestedSites,
    searchResults,
    crawledData,
    totalSources: crawledData.length
  };
}

// Fallback search nếu smart search thất bại
async function searchWebFallback(query) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);
  
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
        .then(d => (d.query?.search || []).map(i => ({ title: i.title, snippet: i.snippet.replace(/<[^>]*>/g, ''), link: `https://en.wikipedia.org/wiki/${encodeURIComponent(i.title.replace(/ /g, '_'))}`, source: 'wikipedia.org', priority: 9 })))
        .catch(() => [])
    ];

    const settled = await Promise.allSettled(searches.map(p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))])));
    const res = settled.filter(r => r.status === 'fulfilled' && Array.isArray(r.value)).flatMap(r => r.value);
    
    clearTimeout(timeout);
    
    return {
      query,
      suggestedSites: [],
      searchResults: res,
      crawledData: [],
      totalSources: res.length
    };
  } catch {
    clearTimeout(timeout);
    return { query, suggestedSites: [], searchResults: [], crawledData: [], totalSources: 0 };
  }
}

// Tóm tắt kết quả tìm kiếm bằng AI
async function summarizeSearchResults(query, searchData) {
  if (searchData.totalSources === 0) {
    return 'Không tìm thấy thông tin phù hợp.';
  }
  
  try {
    // Chuẩn bị dữ liệu để gửi cho AI
    let context = '';
    
    // Thêm nội dung đã crawl (ưu tiên cao nhất)
    if (searchData.crawledData && searchData.crawledData.length > 0) {
      context += '=== CRAWLED CONTENT ===\n\n';
      searchData.crawledData.forEach((data, i) => {
        context += `[${i + 1}] ${data.title}\nURL: ${data.url}\n${data.content.substring(0, 1000)}\n\n`;
      });
    }
    
    // Thêm kết quả search
    if (searchData.searchResults && searchData.searchResults.length > 0) {
      context += '\n=== SEARCH RESULTS ===\n\n';
      searchData.searchResults.slice(0, 5).forEach((r, i) => {
        context += `[${i + 1}] ${r.title}\n${r.snippet.substring(0, 200)}\nSource: ${r.source}\n\n`;
      });
    }
    
    // Giới hạn context length
    context = context.substring(0, 4000);
    
    const isVN = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệ]/i.test(query);
    
    const r = await callAISequential([
      { 
        role: 'system', 
        content: `You are a research assistant. Synthesize the information to answer the query.
Language: ${isVN ? 'Vietnamese' : 'English'}
Format:
1. Direct answer (2-3 sentences)
2. Key points (3-5 bullet points with details)
3. Cite sources using [1], [2], etc.
Be comprehensive but concise. Max 400 words.`
      },
      { role: 'user', content: `Query: "${query}"\n\nInformation:\n${context}` }
    ], 'chat', { temperature: 0.3, maxTokens: 600 });
    
    let summary = r.content.trim().replace(/\*\*/g, '');
    
    // Thêm nguồn tham khảo
    const sources = [];
    if (searchData.crawledData) {
      searchData.crawledData.forEach((d, i) => {
        const domain = new URL(d.url).hostname.replace('www.', '');
        sources.push(`[${i + 1}] [${domain}](${d.url})`);
      });
    }
    if (searchData.searchResults && sources.length < 5) {
      searchData.searchResults.slice(0, 5 - sources.length).forEach((r, i) => {
        if (r.link) sources.push(`[${sources.length + 1}] [${r.source}](${r.link})`);
      });
    }
    
    if (sources.length > 0) {
      summary += '\n\n---\n**Nguồn tham khảo:**\n' + sources.join(' • ');
    }
    
    return summary;
  } catch (e) {
    console.error('Error summarizing:', e);
    return 'Đã tìm thấy thông tin nhưng không thể tổng hợp. Vui lòng thử lại.';
  }
}

// Kiểm tra có cần search không
async function shouldSearchWeb(msg) {
  try {
    const searchKeywords = [
      'tìm kiếm', 'tra cứu', 'là gì', 'là ai', 'tìm hiểu', 'thông số', 'giá', 'cấu hình',
      'review', 'đánh giá', 'so sánh', 'tin tức', 'mới nhất', 'hiện tại', 'specs',
      'địa chỉ', 'khi nào', 'ở đâu', 'như thế nào', 'bao nhiêu', 'chi tiết',
      'thông tin về', 'đặc điểm', 'tính năng', 'có gì', 'ra mắt',
      'search', 'find', 'what is', 'who is', 'learn about', 'price', 'latest',
      'current', 'news', 'where', 'when', 'how', 'compare', 'features'
    ];
    
    const msgLower = msg.toLowerCase();
    
    if (searchKeywords.some(kw => msgLower.includes(kw))) {
      return true;
    }
    
    if (msgLower.includes('?') && (
      msgLower.includes('năm') || msgLower.includes('year') ||
      msgLower.includes('hôm nay') || msgLower.includes('today') ||
      msgLower.includes('hiện nay') || msgLower.includes('currently')
    )) {
      return true;
    }
    
    const r = await callAISequential([
      { role: 'system', content: 'Analyze if query needs web search. Reply ONLY "YES" or "NO". YES for: current events, news, real-time data, product info, prices, specs. NO for: general knowledge, coding, creative writing.' },
      { role: 'user', content: `Search needed: "${msg}"` }
    ], 'quick', { temperature: 0.1, maxTokens: 10 });
    
    return r.content.trim().toUpperCase() === 'YES';
  } catch {
    const basicKeywords = ['tìm kiếm', 'search', 'là gì', 'what is'];
    return basicKeywords.some(kw => msg.toLowerCase().includes(kw));
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

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], imgSrc: ["'self'", "data:", "https:", "http:"], connectSrc: ["'self'", "https:", "http:"] } } }));
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

app.get('/', (req, res) => res.json({ status: 'OK', version: '4.0', features: ['DeepSeek Priority', 'Smart Web Crawling', 'AI-Suggested Sources', 'Multi-page Analysis'] }));

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
    stats[id] = { successRate: tot > 0 ? ((d.successCount / tot) * 100).toFixed(1) + '%' : 'N/A', avgTime: d.avgResponseTime > 0 ? d.avgResponseTime.toFixed(0) + 'ms' : 'N/A', totalCalls: tot };
  }
  res.json({ stats });
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
    let msg = '', model = '', isSearch = false, srcs = [];

    const kw = ['tìm kiếm:', 'search:', 'tra cứu:'];
    const hasKw = kw.some(k => uc.toLowerCase().startsWith(k.toLowerCase()));
    const doSearch = hasKw || await shouldSearchWeb(uc);

    if (doSearch) {
      isSearch = true;
      let q = uc;
      if (hasKw) {
        for (const k of kw) {
          if (uc.toLowerCase().startsWith(k.toLowerCase())) {
            q = uc.substring(k.length).trim();
            break;
          }
        }
      }
      
      console.log(`\n🔍 Performing smart search for: "${q}"`);
      const searchData = await smartSearch(q);
      
      if (searchData.totalSources > 0) {
        srcs = searchData.suggestedSites.slice(0, 5);
        msg = await summarizeSearchResults(q, searchData);
        model = 'smart-search';
      } else {
        msg = 'Không tìm thấy thông tin phù hợp. Vui lòng thử câu hỏi khác.';
      }
    } else {
      const mm = messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: sanitizeInput(m.content) }));
      const sys = { role: 'system', content: 'You are Hein, an AI assistant by Hien2309. Answer in user\'s language. Be accurate, concise, and helpful.' };
      try {
        const r = await callAIRacing([sys, ...mm], 'chat', { temperature: 0.7, maxTokens: 500 });
        msg = r.content;
        model = r.modelId;
      } catch {
        return res.status(500).json({ error: 'AI unavailable' });
      }
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    msg += isSearch ? `\n\n*${dt}s | ${srcs.length} sources crawled*` : `\n\n*${model.split('/')[1]} | ${dt}s*`;

    const { data: sm, error: me } = await supabase.from('messages').insert([{ chat_id: cid, role: 'ai', content: sanitizeInput(msg), timestamp: new Date().toISOString() }]).select().single();
    if (me) return res.status(500).json({ error: 'Failed to save' });

    await supabase.from('chats').update({ last_message: sanitizeInput(uc).substring(0, 100), updated_at: new Date().toISOString() }).eq('id', cid);

    res.json({ message: msg, messageId: sm.id, chatId: cid, timestamp: sm.timestamp, isWebSearch: isSearch, usedModel: model });
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
  res.sendFile(idx, err => {
    if (err) res.status(500).json({ error: 'Failed to serve' });
  });
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
  console.log('\n🚀 Optimized Features:');
  console.log('   ✓ DeepSeek Priority (60s timeout)');
  console.log('   ✓ Smart Web Crawling');
  console.log('   ✓ AI-Suggested Sources');
  console.log('   ✓ Multi-page Content Analysis');
  console.log('   ✓ Sequential fallback with all models');
  console.log('\n🔍 Smart Search Pipeline:');
  console.log('   1. AI suggests best websites');
  console.log('   2. Search specific sites');
  console.log('   3. Crawl actual content');
  console.log('   4. Synthesize with AI');
  console.log('\n🔒 Security: Rate limiting + Helmet + CORS');
  console.log('\nVersion: 4.0 - Smart Search with Web Crawling');
  console.log('========================================\n');
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
