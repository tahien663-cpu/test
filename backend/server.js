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

// Validate required environment variables
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

// AI Models with fallback strategy
const AI_MODELS = {
  chat: [
    { id: 'deepseek/deepseek-chat-v3.1:free', timeout: 60000 },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 8000 },
    { id: 'qwen/qwen3-4b:free', timeout: 8000 },
    { id: 'meta-llama/llama-3.3-8b-instruct:free', timeout: 12000 }
  ],
  quick: [
    { id: 'qwen/qwen3-4b:free', timeout: 6000 },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 7000 },
    { id: 'deepseek/deepseek-chat-v3.1:free', timeout: 10000 }
  ],
  research: [
    { id: 'alibaba/tongyi-deepresearch-30b-a3b:free', timeout: 25000 },
    { id: 'deepseek/deepseek-chat-v3.1:free', timeout: 15000 },
    { id: 'google/gemini-2.0-flash-exp:free', timeout: 10000 }
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
        rateLimitUntil: null
      });
    });
  }
}
initModelStats();

function isModelRateLimited(modelId) {
  const tracker = rateLimitTracker.get(modelId);
  if (!tracker || !tracker.isRateLimited) return false;
  
  if (tracker.rateLimitUntil && Date.now() < tracker.rateLimitUntil) {
    return true;
  }
  
  // Reset rate limit
  tracker.isRateLimited = false;
  tracker.rateLimitUntil = null;
  rateLimitTracker.set(modelId, tracker);
  return false;
}

function markModelRateLimited(modelId, seconds = 60) {
  const tracker = rateLimitTracker.get(modelId) || {};
  tracker.isRateLimited = true;
  tracker.rateLimitUntil = Date.now() + seconds * 1000;
  rateLimitTracker.set(modelId, tracker);
  console.log(`⚠️  Model ${modelId} rate limited for ${seconds}s`);
}

function parseRetryAfter(errorMessage) {
  const match = errorMessage.match(/(\d+)\s*seconds?/i);
  return match ? parseInt(match[1]) : 60;
}

function updateModelStats(modelId, success, responseTime) {
  const stats = modelStats.get(modelId);
  if (!stats) return;
  
  if (success) {
    stats.successCount++;
    stats.avgResponseTime = stats.avgResponseTime === 0 
      ? responseTime 
      : stats.avgResponseTime * 0.7 + responseTime * 0.3;
  } else {
    stats.failCount++;
  }
  
  stats.lastUsed = Date.now();
  modelStats.set(modelId, stats);
}

function getSortedModels(category) {
  const models = AI_MODELS[category] || AI_MODELS.chat;
  const available = models.filter(m => !isModelRateLimited(m.id));
  
  if (available.length === 0) {
    console.log(`⚠️  All models in ${category} are rate limited, using full list`);
    return models;
  }
  
  return available;
}

async function callAISequential(messages, category = 'chat', options = {}) {
  const models = getSortedModels(category);
  const { temperature = 0.7, maxTokens = 500 } = options;
  
  for (const model of models) {
    if (isModelRateLimited(model.id)) continue;
    
    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), model.timeout);
    
    try {
      console.log(`🤖 Trying ${model.id}...`);
      
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
          messages: messages,
          temperature: temperature,
          max_tokens: maxTokens
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.log(`   ❌ ${model.id} failed (${response.status})`);
        
        if (response.status === 429 || errorText.toLowerCase().includes('rate limit')) {
          const retrySeconds = parseRetryAfter(errorText);
          markModelRateLimited(model.id, retrySeconds);
        }
        
        updateModelStats(model.id, false, responseTime);
        continue;
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        console.log(`   ❌ ${model.id} returned empty content`);
        updateModelStats(model.id, false, responseTime);
        continue;
      }
      
      console.log(`   ✓ ${model.id} succeeded (${responseTime}ms)`);
      updateModelStats(model.id, true, responseTime);
      
      return {
        content: content,
        modelId: model.id,
        responseTime: responseTime
      };
      
    } catch (error) {
      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;
      
      if (error.name === 'AbortError') {
        console.log(`   ⏱️  ${model.id} timeout (${model.timeout}ms)`);
      } else {
        console.log(`   ❌ ${model.id} error: ${error.message}`);
      }
      
      updateModelStats(model.id, false, responseTime);
      continue;
    }
  }
  
  throw new Error('All AI models failed or are rate limited');
}

async function enhancePrompt(text, isImage = false) {
  try {
    const systemPrompt = isImage 
      ? 'Translate to English and add artistic details. Maximum 70 characters, no punctuation. Only return the enhanced prompt.'
      : 'Enhance this prompt to be clearer and more detailed. Maximum 200 characters. Only return the enhanced prompt.';
    
    const result = await callAISequential([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Enhance: "${text}"` }
    ], 'quick', { maxTokens: isImage ? 100 : 200 });
    
    const enhanced = result.content.trim() || text;
    const maxLength = isImage ? 200 : 500;
    
    return enhanced.length > maxLength 
      ? enhanced.substring(0, maxLength - 3) + '...' 
      : enhanced;
      
  } catch (error) {
    console.log('Prompt enhancement failed, using original');
    return text;
  }
}

// ========== ENHANCED SEARCH FUNCTIONS ==========

function detectQueryType(query) {
  const queryLower = query.toLowerCase();
  
  // Product model patterns
  const productPatterns = [
    /\b(dell|hp|lenovo|asus|acer|msi)\s+[a-z]?\d{4,}/i,
    /\b(iphone|galaxy|pixel|oneplus|xiaomi|oppo|vivo)\s+\d+/i,
    /\b(macbook|thinkpad|inspiron|latitude|vostro|pavilion|vivobook)\s+[a-z]?\d+/i,
    /\b(rtx|gtx|radeon)\s+\d{4}/i,
    /\b(core\s+i\d|ryzen\s+\d)/i
  ];
  
  if (productPatterns.some(pattern => pattern.test(query))) {
    return 'product_specific';
  }
  
  // Brand queries
  const brands = ['apple', 'samsung', 'dell', 'hp', 'lenovo', 'asus', 'xiaomi', 'oppo', 'vivo'];
  if (brands.some(brand => queryLower.includes(brand))) {
    return 'brand_related';
  }
  
  // Technical queries
  const techKeywords = ['specs', 'specification', 'review', 'benchmark', 'performance', 'cấu hình', 'thông số', 'đánh giá'];
  if (techKeywords.some(keyword => queryLower.includes(keyword))) {
    return 'technical';
  }
  
  return 'general';
}

function getFallbackSites(query, isVietnamese) {
  const queryLower = query.toLowerCase();
  const queryType = detectQueryType(query);
  
  // Laptop queries
  if (queryLower.includes('laptop') || queryLower.includes('dell') || queryLower.includes('hp') || 
      queryLower.includes('lenovo') || queryLower.includes('asus')) {
    return isVietnamese
      ? ['https://www.notebookcheck.net', 'https://tinhte.vn', 'https://www.laptopmag.com', 
         'https://fptshop.com.vn', 'https://www.pcmag.com', 'https://thegioididong.com', 'https://genk.vn']
      : ['https://www.notebookcheck.net', 'https://www.laptopmag.com', 'https://www.pcmag.com', 
         'https://www.theverge.com', 'https://www.tomshardware.com', 'https://www.techradar.com', 'https://www.ultrabookreview.com'];
  }
  
  // Phone queries
  if (queryLower.includes('iphone') || queryLower.includes('apple') || queryLower.includes('samsung') || queryLower.includes('galaxy')) {
    return isVietnamese 
      ? ['https://www.gsmarena.com', 'https://www.apple.com', 'https://www.samsung.com', 
         'https://tinhte.vn', 'https://thegioididong.com', 'https://fptshop.com.vn', 'https://genk.vn']
      : ['https://www.gsmarena.com', 'https://www.apple.com', 'https://www.samsung.com', 
         'https://www.theverge.com', 'https://www.cnet.com', 'https://www.androidauthority.com', 'https://9to5mac.com'];
  }
  
  // General tech
  return isVietnamese
    ? ['https://vi.wikipedia.org', 'https://tinhte.vn', 'https://genk.vn', 'https://vnexpress.net', 'https://en.wikipedia.org']
    : ['https://en.wikipedia.org', 'https://www.theverge.com', 'https://www.cnet.com', 'https://www.techradar.com', 'https://www.bbc.com'];
}

async function suggestWebsites(query) {
  try {
    const isVietnamese = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíĩỉịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(query);
    const queryType = detectQueryType(query);
    
    let productModel = '';
    const modelMatch = query.match(/\b([a-z]+)\s+([a-z]?\d{4,})/i);
    if (modelMatch) {
      productModel = modelMatch[0];
    }
    
    const systemPrompt = isVietnamese 
      ? `Bạn là chuyên gia tìm kiếm. Đề xuất 7 trang web TỐT NHẤT để tìm thông tin về: "${query}"
${productModel ? `Sản phẩm: ${productModel}` : ''}
Loại: ${queryType}

YÊU CẦU:
1. Ưu tiên trang CHÍNH THỨC
2. Trang review uy tín
3. Wikipedia
4. Trang tin công nghệ

Trả về JSON array: ["url1", "url2", ...]`
      : `You are a search expert. Suggest 7 BEST websites for: "${query}"
${productModel ? `Product: ${productModel}` : ''}
Type: ${queryType}

REQUIREMENTS:
1. Prioritize OFFICIAL sites
2. Reputable review sites
3. Wikipedia
4. Tech news sites

Return JSON array: ["url1", "url2", ...]`;

    let result;
    try {
      result = await callAISequential([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Find websites for: "${query}"` }
      ], 'research', { temperature: 0.1, maxTokens: 400 });
    } catch {
      console.log('   Research model failed, using quick models');
      result = await callAISequential([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Find websites for: "${query}"` }
      ], 'quick', { temperature: 0.1, maxTokens: 400 });
    }
    
    const content = result.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    
    if (!jsonMatch) {
      console.log('   No JSON found, using fallback sites');
      return getFallbackSites(query, isVietnamese);
    }
    
    const sites = JSON.parse(jsonMatch[0]);
    const validSites = sites
      .filter(s => typeof s === 'string' && s.startsWith('http'))
      .slice(0, 7);
    
    if (validSites.length === 0) {
      return getFallbackSites(query, isVietnamese);
    }
    
    // Add fallback if needed
    if (validSites.length < 5) {
      const fallback = getFallbackSites(query, isVietnamese);
      fallback.forEach(site => {
        if (validSites.length < 7 && !validSites.includes(site)) {
          validSites.push(site);
        }
      });
    }
    
    return validSites;
    
  } catch (error) {
    console.error('   Error suggesting websites:', error.message);
    return getFallbackSites(query, /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíĩỉịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(query));
  }
}

async function searchSpecificSites(query, sites) {
  const results = [];
  
  let productModel = '';
  const modelMatch = query.match(/\b([a-z]+)\s+([a-z]?\d{4,})/i);
  if (modelMatch) {
    productModel = modelMatch[0];
  }
  
  for (const site of sites) {
    try {
      const domain = new URL(site).hostname.replace('www.', '');
      const searchQuery = productModel 
        ? `${productModel} specifications review`
        : query;
      
      const siteSearch = `${searchQuery} site:${domain}`;
      const encodedQuery = encodeURIComponent(siteSearch);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        const data = await response.json();
        
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
          data.RelatedTopics.slice(0, 5).forEach(topic => {
            if (topic.Text && topic.FirstURL) {
              const topicDomain = new URL(topic.FirstURL).hostname.replace('www.', '');
              if (topicDomain === domain || topic.FirstURL.includes(domain)) {
                results.push({
                  title: topic.Text.split(' - ')[0],
                  snippet: topic.Text,
                  link: topic.FirstURL,
                  source: domain,
                  priority: 8
                });
              }
            }
          });
        }
      }
    } catch (error) {
      console.error(`Error searching ${site}:`, error.message);
    }
  }
  
  return results;
}

async function crawlWebpage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) return null;
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Remove unwanted elements
    $('script, style, nav, header, footer, iframe, noscript').remove();
    
    const title = $('title').text().trim() || $('h1').first().text().trim();
    
    // Extract main content
    const contentSelectors = [
      'article', '[role="main"]', 'main', '.content', '.article-content',
      '.post-content', '#content', '.entry-content', '.product-description',
      '.specs-table', '.specifications', '.review-content'
    ];
    
    let content = '';
    for (const selector of contentSelectors) {
      const elem = $(selector);
      if (elem.length > 0) {
        content = elem.text();
        break;
      }
    }
    
    if (!content) {
      content = $('body').text();
    }
    
    // Extract specifications
    const specs = {};
    $('table.specs, table.specifications, .spec-table').each((i, table) => {
      $(table).find('tr').each((j, row) => {
        const cells = $(row).find('td, th');
        if (cells.length >= 2) {
          const key = $(cells[0]).text().trim();
          const value = $(cells[1]).text().trim();
          if (key && value) {
            specs[key] = value;
          }
        }
      });
    });
    
    if (Object.keys(specs).length > 0) {
      content += '\n\n=== SPECIFICATIONS ===\n';
      for (const [key, value] of Object.entries(specs)) {
        content += `${key}: ${value}\n`;
      }
    }
    
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
      .substring(0, 5000);
    
    return { title, content, url, specs };
    
  } catch (error) {
    console.error(`Error crawling ${url}:`, error.message);
    return null;
  }
}

async function smartSearch(query) {
  console.log(`\n🔍 Smart Search: "${query}"`);
  const queryType = detectQueryType(query);
  console.log(`   Query type: ${queryType}`);
  
  try {
    console.log('📍 Step 1: Suggesting websites...');
    const suggestedSites = await suggestWebsites(query);
    console.log(`   Found ${suggestedSites.length} sites`);
    
    if (suggestedSites.length === 0) {
      return await searchWebFallback(query);
    }
    
    console.log('🔎 Step 2: Searching specific sites...');
    const searchResults = await searchSpecificSites(query, suggestedSites);
    console.log(`   Found ${searchResults.length} search results`);
    
    console.log('📥 Step 3: Crawling webpages...');
    let topUrls = [...new Set(searchResults.map(r => r.link))].slice(0, 5);
    
    if (topUrls.length === 0) {
      console.log('   No search results, crawling suggested sites');
      topUrls = suggestedSites.slice(0, 5);
    }
    
    if (topUrls.length === 0) {
      return await searchWebFallback(query);
    }
    
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
    
  } catch (error) {
    console.error('   Smart search error:', error.message);
    return await searchWebFallback(query);
  }
}

async function searchWebFallback(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  
  try {
    const encodedQuery = encodeURIComponent(query);
    
    const searches = [
      fetch(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
        .then(r => r.json())
        .then(data => {
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
            data.RelatedTopics.slice(0, 5).forEach(topic => {
              if (topic.Text && topic.FirstURL) {
                const domain = new URL(topic.FirstURL).hostname;
                results.push({
                  title: topic.Text.split(' - ')[0],
                  snippet: topic.Text,
                  link: topic.FirstURL,
                  source: domain,
                  priority: 5
                });
              }
            });
          }
          return results;
        })
        .catch(() => []),
      
      fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&srlimit=3&origin=*`, {
        signal: controller.signal
      })
        .then(r => r.json())
        .then(data => (data.query?.search || []).map(item => ({
          title: item.title,
          snippet: item.snippet.replace(/<[^>]*>/g, ''),
          link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
          source: 'wikipedia.org',
          priority: 9
        })))
        .catch(() => [])
    ];

    const settled = await Promise.allSettled(
      searches.map(p => Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
      ]))
    );
    
    const results = settled
      .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
      .flatMap(r => r.value);
    
    clearTimeout(timeout);
    
    return {
      query,
      queryType: 'general',
      suggestedSites: [],
      searchResults: results,
      crawledData: [],
      totalSources: results.length
    };
    
  } catch {
    clearTimeout(timeout);
    return {
      query,
      queryType: 'general',
      suggestedSites: [],
      searchResults: [],
      crawledData: [],
      totalSources: 0
    };
  }
}

async function summarizeSearchResults(query, searchData) {
  if (searchData.totalSources === 0) {
    return 'Không tìm thấy thông tin phù hợp.';
  }
  
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
      searchData.searchResults.slice(0, 5).forEach((result, i) => {
        context += `[${sourceCount + i + 1}] ${result.title}\n${result.snippet.substring(0, 300)}\nSource: ${result.source}\n\n`;
      });
    }
    
    context = context.substring(0, 6000);
    
    const isVietnamese = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệ]/i.test(query);
    const queryType = searchData.queryType || 'general';
    
    let systemPrompt = `You are a research assistant. Synthesize information to answer queries.
Language: ${isVietnamese ? 'Vietnamese' : 'English'}
Query type: ${queryType}

Format:
1. Direct answer (2-3 sentences)
2. Key points (bullet points)
3. Cite sources using [1], [2]

Be comprehensive but concise. Max 600 words.`;

    if (queryType === 'product_specific') {
      systemPrompt += `\n\nFOR PRODUCTS: Focus on specs, features, pricing, pros/cons`;
    }
    
    const result = await callAISequential([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Query: "${query}"\n\nInformation:\n${context}` }
    ], 'chat', { temperature: 0.3, maxTokens: 800 });
    
    let summary = result.content.trim().replace(/\*\*/g, '');
    
    // Add sources
    const sources = [];
    if (searchData.crawledData) {
      searchData.crawledData.forEach((data, i) => {
        try {
          const domain = new URL(data.url).hostname.replace('www.', '');
          sources.push(`[${i + 1}] [${domain}](${data.url})`);
        } catch {
          sources.push(`[${i + 1}] ${data.url}`);
        }
      });
    }
    
    if (searchData.searchResults && sources.length < 5) {
      searchData.searchResults.slice(0, 5 - sources.length).forEach((result, i) => {
        if (result.link) {
          try {
            sources.push(`[${sources.length + 1}] [${result.source}](${result.link})`);
          } catch {
            sources.push(`[${sources.length + 1}] ${result.source}`);
          }
        }
      });
    }
    
    if (sources.length > 0) {
      summary += '\n\n---\n**Nguồn tham khảo:**\n' + sources.join(' • ');
    }
    
    return summary;
    
  } catch (error) {
    console.error('Error summarizing:', error);
    return 'Đã tìm thấy thông tin nhưng không thể tổng hợp. Vui lòng thử lại.';
  }
}

async function shouldSearchWeb(message) {
  try {
    const searchKeywords = [
      'tìm kiếm', 'tra cứu', 'là gì', 'là ai', 'tìm hiểu', 'thông số', 'giá', 'cấu hình',
      'review', 'đánh giá', 'so sánh', 'tin tức', 'mới nhất', 'hiện tại', 'specs',
      'địa chỉ', 'khi nào', 'ở đâu', 'như thế nào', 'bao nhiêu', 'chi tiết',
      'thông tin về', 'đặc điểm', 'tính năng', 'có gì', 'ra mắt',
      'search', 'find', 'what is', 'who is', 'learn about', 'price', 'latest',
      'current', 'news', 'where', 'when', 'how', 'compare', 'features'
    ];
    
    const messageLower = message.toLowerCase();
    
    if (searchKeywords.some(keyword => messageLower.includes(keyword))) {
      return true;
    }
    
    if (messageLower.includes('?') && (
      messageLower.includes('năm') || messageLower.includes('year') ||
      messageLower.includes('hôm nay') || messageLower.includes('today') ||
      messageLower.includes('hiện nay') || messageLower.includes('currently')
    )) {
      return true;
    }
    
    const result = await callAISequential([
      { role: 'system', content: 'Analyze if query needs web search. Reply ONLY "YES" or "NO". YES for: current events, news, real-time data, product info, prices, specs. NO for: general knowledge, coding, creative writing.' },
      { role: 'user', content: `Search needed: "${message}"` }
    ], 'quick', { temperature: 0.1, maxTokens: 10 });
    
    return result.content.trim().toUpperCase() === 'YES';
    
  } catch {
    const basicKeywords = ['tìm kiếm', 'search', 'là gì', 'what is'];
    return basicKeywords.some(keyword => message.toLowerCase().includes(keyword));
  }
}

async function verifyImage(url) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
        return { success: true, attempts: attempt };
      }
    } catch (error) {
      // Continue to next attempt
    }
    
    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
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

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many authentication attempts' },
  skipSuccessfulRequests: true
});

const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many image requests' }
});

const allowedOrigins = [
  'https://hein1.onrender.com',
  'https://test-d9o3.onrender.com',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000', 'http://localhost:5173'] : [])
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'test', 'frontend', 'dist'), { maxAge: '1d' }));
app.use(generalLimiter);

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return xss(input.trim(), {
    whiteList: {
      a: ['href'],
      img: ['src', 'alt'],
      b: [],
      strong: [],
      i: [],
      em: [],
      code: [],
      pre: [],
      ul: [],
      ol: [],
      li: [],
      p: [],
      br: []
    },
    stripIgnoreTag: true
  });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// ========== ROUTES ==========

app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    version: '4.2',
    features: [
      'DeepSeek Priority',
      'Enhanced Smart Web Crawling',
      'Product-Specific Search',
      'Multi-page Analysis',
      'DeepResearch Integration',
      'Query Type Detection'
    ]
  });
});

app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    
    res.json({
      status: 'OK',
      uptime: process.uptime()
    });
  } catch {
    res.status(503).json({ status: 'ERROR' });
  }
});

app.get('/api/model-stats', (req, res) => {
  const stats = {};
  
  for (const [modelId, data] of modelStats.entries()) {
    const total = data.successCount + data.failCount;
    stats[modelId] = {
      successRate: total > 0 ? ((data.successCount / total) * 100).toFixed(1) + '%' : 'N/A',
      avgTime: data.avgResponseTime > 0 ? data.avgResponseTime.toFixed(0) + 'ms' : 'N/A',
      totalCalls: total
    };
  }
  
  res.json({ stats });
});

app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedName = sanitizeInput(name);
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', sanitizedEmail)
      .maybeSingle();
    
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        email: sanitizedEmail,
        password: hashedPassword,
        name: sanitizedName
      }])
      .select()
      .single();
    
    if (error) {
      return res.status(500).json({ error: 'Registration failed' });
    }
    
    const token = jwt.sign(
      { id: user.id, email: user.email },
      jwtSecret,
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
    
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }
    
    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', sanitizedEmail)
      .maybeSingle();
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user.id, email: user.email },
      jwtSecret,
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
    
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { messages, chatId, prompt } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }
    
    const userId = req.user.id;
    let currentChatId = chatId;

    // Create new chat if needed
    if (!currentChatId) {
      const firstMessage = sanitizeInput(prompt || messages[0]?.content || 'New chat');
      
      const { data: chat, error } = await supabase
        .from('chats')
        .insert([{
          user_id: userId,
          title: firstMessage.substring(0, 50)
        }])
        .select()
        .single();
      
      if (error) {
        return res.status(500).json({ error: 'Failed to create chat' });
      }
      
      currentChatId = chat.id;
    } else {
      // Verify chat ownership
      const { data: chat } = await supabase
        .from('chats')
        .select('id')
        .eq('id', currentChatId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      
      currentChatId = chat.id;
    }

    // Get user content
    const userContent = prompt 
      ? sanitizeInput(prompt) 
      : sanitizeInput(messages.filter(m => m.role === 'user').pop()?.content || '');
    
    if (!userContent) {
      return res.status(400).json({ error: 'No message content' });
    }

    // Save user message
    await supabase.from('messages').insert([{
      chat_id: currentChatId,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString()
    }]);

    const startTime = Date.now();
    let responseMessage = '';
    let usedModel = '';
    let isSearch = false;
    let sources = [];

    // Check if search is needed
    const searchKeywords = ['tìm kiếm:', 'search:', 'tra cứu:'];
    const hasSearchKeyword = searchKeywords.some(keyword => 
      userContent.toLowerCase().startsWith(keyword.toLowerCase())
    );
    
    const needsSearch = hasSearchKeyword || await shouldSearchWeb(userContent);

    if (needsSearch) {
      isSearch = true;
      let searchQuery = userContent;
      
      // Extract query after keyword
      if (hasSearchKeyword) {
        for (const keyword of searchKeywords) {
          if (userContent.toLowerCase().startsWith(keyword.toLowerCase())) {
            searchQuery = userContent.substring(keyword.length).trim();
            break;
          }
        }
      }
      
      console.log(`\n🔍 Performing enhanced smart search for: "${searchQuery}"`);
      const searchData = await smartSearch(searchQuery);
      
      if (searchData.totalSources > 0) {
        sources = searchData.suggestedSites.slice(0, 5);
        responseMessage = await summarizeSearchResults(searchQuery, searchData);
        usedModel = 'enhanced-smart-search';
      } else {
        responseMessage = 'Không tìm thấy thông tin phù hợp. Vui lòng thử câu hỏi khác hoặc cụ thể hóa hơn.';
      }
    } else {
      // Regular AI chat
      const formattedMessages = messages.map(m => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: sanitizeInput(m.content)
      }));
      
      const systemMessage = {
        role: 'system',
        content: 'You are Hein, an AI assistant created by Hien2309. Answer in the user\'s language. Be accurate, concise, and helpful.'
      };
      
      try {
        const result = await callAISequential(
          [systemMessage, ...formattedMessages],
          'chat',
          { temperature: 0.7, maxTokens: 500 }
        );
        
        responseMessage = result.content;
        usedModel = result.modelId;
      } catch {
        return res.status(500).json({ error: 'AI service unavailable' });
      }
    }

    const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);
    responseMessage += isSearch 
      ? `\n\n*${responseTime}s | ${sources.length} sources analyzed*`
      : `\n\n*${usedModel.split('/')[1]} | ${responseTime}s*`;

    // Save AI response
    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([{
        chat_id: currentChatId,
        role: 'ai',
        content: sanitizeInput(responseMessage),
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (messageError) {
      return res.status(500).json({ error: 'Failed to save message' });
    }

    // Update chat metadata
    await supabase
      .from('chats')
      .update({
        last_message: sanitizeInput(userContent).substring(0, 100),
        updated_at: new Date().toISOString()
      })
      .eq('id', currentChatId);

    res.json({
      message: responseMessage,
      messageId: savedMessage.id,
      chatId: currentChatId,
      timestamp: savedMessage.timestamp,
      isWebSearch: isSearch,
      usedModel: usedModel
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/generate-image', authenticateToken, imageLimiter, async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Invalid prompt' });
    }
    
    if (prompt.length > 500) {
      return res.status(400).json({ error: 'Prompt too long (max 500 characters)' });
    }

    const sanitizedPrompt = sanitizeInput(prompt);
    const userId = req.user.id;
    let currentChatId = chatId;

    // Create chat if needed
    if (!currentChatId) {
      const { data: chat, error } = await supabase
        .from('chats')
        .insert([{
          user_id: userId,
          title: `Image: ${sanitizedPrompt.substring(0, 40)}`
        }])
        .select()
        .single();
      
      if (error) {
        return res.status(500).json({ error: 'Failed to create chat' });
      }
      
      currentChatId = chat.id;
    } else {
      const { data: chat } = await supabase
        .from('chats')
        .select('id')
        .eq('id', currentChatId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      
      currentChatId = chat.id;
    }

    // Save user prompt
    await supabase.from('messages').insert([{
      chat_id: currentChatId,
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

    const buffer = await imageResponse.buffer();
    const imageId = uuidv4();
    let finalUrl = imageUrl;

    // Try to store in Supabase
    const { error: storageError } = await supabase.storage
      .from('images')
      .upload(`public/${imageId}.png`, buffer, {
        contentType: contentType,
        upsert: true
      });
    
    if (!storageError) {
      const { data: signedData } = await supabase.storage
        .from('images')
        .createSignedUrl(`public/${imageId}.png`, 86400);
      
      if (signedData?.signedUrl) {
        finalUrl = signedData.signedUrl;
      }
    }

    // Verify image
    const verification = await verifyImage(finalUrl);
    const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    const messageContent = `![Image](${finalUrl})\n\n*Enhanced: ${enhancedPrompt}*\n*${responseTime}s ${verification.success ? '(verified)' : ''}*`;

    // Save AI response
    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([{
        chat_id: currentChatId,
        role: 'ai',
        content: messageContent,
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (messageError) {
      return res.status(500).json({ error: 'Failed to save message' });
    }

    // Update chat
    await supabase
      .from('chats')
      .update({
        last_message: `Image: ${sanitizedPrompt.substring(0, 50)}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', currentChatId);

    res.json({
      message: messageContent,
      imageUrl: finalUrl,
      enhancedPrompt: enhancedPrompt,
      messageId: savedMessage.id,
      chatId: currentChatId,
      timestamp: savedMessage.timestamp
    });
    
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

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
    
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch history' });
    }

    const history = await Promise.all(chats.map(async chat => {
      const { data: messages } = await supabase
        .from('messages')
        .select('id, role, content, timestamp')
        .eq('chat_id', chat.id)
        .order('timestamp', { ascending: true })
        .limit(100);
      
      return {
        ...chat,
        messages: messages || []
      };
    }));

    res.json({
      history,
      page,
      limit
    });
    
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

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
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Delete messages first
    await supabase.from('messages').delete().eq('chat_id', chatId);
    
    // Delete chat
    await supabase.from('chats').delete().eq('id', chatId).eq('user_id', userId);
    
    res.json({
      message: 'Chat deleted successfully',
      chatId
    });
    
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    if (!validate(messageId)) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }
    
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('chat_id')
      .eq('id', messageId)
      .maybeSingle();
    
    if (messageError || !message) {
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
    
    // Update last message
    const { data: lastMessage } = await supabase
      .from('messages')
      .select('content')
      .eq('chat_id', message.chat_id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (lastMessage) {
      await supabase
        .from('chats')
        .update({
          last_message: sanitizeInput(lastMessage.content).substring(0, 100),
          updated_at: new Date().toISOString()
        })
        .eq('id', message.chat_id);
    }
    
    res.json({
      message: 'Message deleted successfully',
      messageId
    });
    
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Catch-all route for SPA
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  const indexPath = path.join(__dirname, 'test', 'frontend', 'dist', 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      res.status(500).json({ error: 'Failed to serve application' });
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  
  if (err.message === 'CORS not allowed') {
    return res.status(403).json({ error: 'CORS error' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// ========== SERVER STARTUP ==========

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log('========================================');
  console.log(`Server running on port ${PORT}`);
  console.log('========================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('\n🚀 Enhanced Features:');
  console.log('   ✓ DeepSeek Priority (60s timeout)');
  console.log('   ✓ Product-Specific Search Detection');
  console.log('   ✓ Enhanced Web Crawling (specs extraction)');
  console.log('   ✓ DeepResearch for website suggestions');
  console.log('   ✓ Multi-page Content Analysis (5000 chars/page)');
  console.log('   ✓ Query Type Detection (product/brand/technical/general)');
  console.log('   ✓ Intelligent fallback system');
  console.log('   ✓ Sequential fallback with all models');
  console.log('\n🔍 Enhanced Smart Search Pipeline:');
  console.log('   1. Detect query type');
  console.log('   2. AI suggests 7 best websites');
  console.log('   3. Search specific sites');
  console.log('   4. Crawl content + extract specifications');
  console.log('   5. Synthesize with context-aware AI');
  console.log('   6. Fallback to standard search if needed');
  console.log('\n🔒 Security: Rate limiting + Helmet + CORS');
  console.log('\nVersion: 4.2 - Enhanced Product Search & Query Detection');
  console.log('========================================\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
