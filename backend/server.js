
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import cors from 'cors';

// Dynamic import cho cheerio để tránh lỗi top-level await
let cheerio;
(async () => {
  cheerio = await import('cheerio');
})();

dotenv.config();

// Kiểm tra biến môi trường
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENROUTER_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Lỗi: ${envVar} phải được thiết lập trong file .env`);
    process.exit(1);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openRouterKey = process.env.OPENROUTER_API_KEY;
const jwtSecret = process.env.JWT_SECRET || 'supersecret';

// Middleware kiểm tra kích thước payload
app.use((req, res, next) => {
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
    return res.status(413).json({ error: 'Payload quá lớn, tối đa 50MB' });
  }
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Lỗi server:', err);
  res.status(500).json({ error: 'Lỗi server nội bộ', details: err.message || 'Lỗi không xác định' });
});

// Middleware xác thực JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token không hợp lệ' });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token hết hạn hoặc không hợp lệ' });
  }
}

// Hàm retry API với exponential backoff
async function retryAPICall(apiCall, maxRetries = 3, initialDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await apiCall();
      
      if (response.status !== 429) {
        return response;
      }
      
      if (attempt === maxRetries) {
        throw new Error('Đã đạt số lần thử tối đa do giới hạn tỷ lệ');
      }
      
      const retryAfter = response.headers.get('retry-after') || response.headers.get('x-ratelimit-reset');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : initialDelay * Math.pow(2, attempt - 1);
      
      console.log(`Giới hạn tỷ lệ, thử lại sau ${delay}ms (lần thử ${attempt}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Yêu cầu API bị hủy');
        return null; // Trả về null nếu yêu cầu bị hủy
      }
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`Lần thử ${attempt} thất bại:`, err.message);
      await new Promise(resolve => setTimeout(resolve, initialDelay * attempt));
    }
  }
}

// Dịch sang tiếng Việt cho kết quả tìm kiếm
async function translateToVietnamese(text) {
  try {
    const response = await retryAPICall(() => 
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein-ai.com',
          'X-Title': 'Hein AI',
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: [
            {
              role: 'system',
              content: 'Bạn là trợ lý dịch thuật. Dịch văn bản sang tiếng Việt một cách chính xác, tự nhiên và chi tiết. Chỉ trả về bản dịch.',
            },
            {
              role: 'user',
              content: `Dịch sang tiếng Việt: ${text}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 500,
          stream: false,
        }),
      })
    );

    if (!response) return text; // Yêu cầu bị hủy
    if (!response.ok) {
      throw new Error(`Lỗi API dịch: ${response.status}`);
    }

    const data = await response.json();
    const translated = data.choices[0]?.message?.content?.trim() || text;
    console.log(`Đã dịch sang tiếng Việt: "${text}" → "${translated}"`);
    return translated;
  } catch (err) {
    console.warn('Dịch thất bại, dùng văn bản gốc:', err.message);
    return text;
  }
}

// Dịch sang tiếng Anh (chỉ cho tạo ảnh)
async function translateToEnglish(text) {
  try {
    const response = await retryAPICall(() => 
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein-ai.com',
          'X-Title': 'Hein AI',
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: [
            {
              role: 'system',
              content: 'Bạn là trợ lý dịch thuật sáng tạo. Dịch văn bản sang tiếng Anh một cách chính xác, thêm chi tiết để làm rõ ý nghĩa, ngắn gọn nhưng đầy đủ. Chỉ trả về bản dịch chi tiết.',
            },
            {
              role: 'user',
              content: `Dịch sang tiếng Anh: ${text}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 100,
          stream: false,
        }),
      })
    );

    if (!response) return text; // Yêu cầu bị hủy
    if (!response.ok) {
      throw new Error(`Lỗi API dịch: ${response.status}`);
    }

    const data = await response.json();
    const translated = data.choices[0]?.message?.content?.trim() || text;
    console.log(`Đã dịch: "${text}" → "${translated}"`);
    return translated;
  } catch (err) {
    console.warn('Dịch thất bại, dùng văn bản gốc:', err.message);
    return text;
  }
}

// Hàm tìm kiếm web với giới hạn 5 kết quả
async function webSearch(query) {
  try {
    if (!cheerio) throw new Error('Cheerio chưa được tải');
    const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Tìm kiếm thất bại với mã trạng thái ${response.status}`);
    }

    const html = await response.text().catch(() => '');
    if (!html) throw new Error('Phản hồi tìm kiếm rỗng');
    
    const $ = cheerio.load(html);
    const results = [];

    // Lấy tối đa 5 kết quả
    $('.result').slice(0, 5).each((i, el) => {
      const title = $(el).find('.result__title').text().trim();
      let link = $(el).find('.result__url').attr('href') || $(el).find('.result__a').attr('href');
      const snippet = $(el).find('.result__snippet').text().trim();

      // Chỉ lấy kết quả có snippet dài hơn 8 ký tự
      if (title && link && snippet && snippet.length > 8) {
        link = link.startsWith('http') ? link : `https://duckduckgo.com${link}`;
        
        // Lọc các trang quảng cáo hoặc không liên quan
        if (!link.includes('ad.') && !link.includes('sponsor') && !link.includes('doubleclick') && !link.includes('shop')) {
          results.push({
            title,
            link,
            snippet
          });
        }
      }
    });

    // Dịch kết quả sang tiếng Việt
    const translatedResults = [];
    for (const result of results) {
      const translatedTitle = await translateToVietnamese(result.title);
      const translatedSnippet = await translateToVietnamese(result.snippet);
      translatedResults.push({
        title: translatedTitle,
        link: result.link,
        snippet: translatedSnippet
      });
    }

    return translatedResults;
  } catch (err) {
    console.error('Lỗi tìm kiếm web:', err.message);
    return [];
  }
}

// Endpoint đăng ký
app.post('/api/register', async (req, res) => {
  try {
    console.log('=== REGISTER DEBUG START ===');
    console.log('Request body:', req.body);
    
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      console.log('Thiếu trường dữ liệu');
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Đang cố gắng thêm người dùng...');
    
    const userId = uuidv4();
    const userData = {
      id: userId,
      name: name.trim(),
      email: email.toLowerCase(),
      password: hashedPassword
    };
    
    console.log('Dữ liệu:', { ...userData, password: '[HASHED]' });

    const { data: newUser, error } = await supabase
      .from('users')
      .insert(userData)
      .select('id, name, email')
      .single();

    console.log('Phản hồi Supabase - dữ liệu:', newUser);
    console.log('Phản hồi Supabase - lỗi:', error);

    if (error) {
      console.error('=== CHI TIẾT LỖI SUPABASE ===');
      console.error('Mã:', error.code);
      console.error('Thông báo:', error.message);
      console.error('Chi tiết:', error.details);
      
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Email đã được đăng ký' });
      }
      
      return res.status(500).json({ 
        error: 'Lỗi database', 
        details: error.message,
        code: error.code 
      });
    }

    console.log('Tạo người dùng thành công!');
    console.log('=== REGISTER DEBUG END ===');

    res.json({ 
      message: 'Đăng ký thành công!',
      user: { name: newUser.name, email: newUser.email }
    });

  } catch (err) {
    console.error('=== LỖI ĐÃ BẮT ===');
    console.error('Lỗi:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'Lỗi server', details: err.message });
  }
});

// Endpoint đăng nhập
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Thiếu email hoặc mật khẩu' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
    res.json({ token, user: { name: user.name, email: user.email } });
  } catch (err) {
    console.error('Lỗi đăng nhập:', err.message);
    res.status(500).json({ error: 'Lỗi server', details: err.message });
  }
});

// Endpoint lấy lịch sử chat
app.get('/api/chat/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: chats, error: chatsError } = await supabase
      .from('chats')
      .select('id, title, last_message, timestamp')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false });

    if (chatsError) {
      console.error('Lỗi Supabase chats:', chatsError);
      return res.status(500).json({ error: 'Lỗi truy vấn chats', details: chatsError.message });
    }

    if (!chats?.length) {
      return res.json({ history: [] });
    }

    const { data: allMessages, error: msgsError } = await supabase
      .from('messages')
      .select('id, chat_id, role, content, timestamp')
      .in('chat_id', chats.map(c => c.id))
      .order('timestamp', { ascending: true });

    if (msgsError) {
      console.error('Lỗi Supabase messages:', msgsError);
      return res.status(500).json({ error: 'Lỗi truy vấn messages', details: msgsError.message });
    }

    const history = chats.map(chat => ({
      ...chat,
      messages: allMessages?.filter(m => m.chat_id === chat.id) || []
    }));

    res.json({ history });
  } catch (err) {
    console.error('Lỗi lấy lịch sử chat:', err);
    res.status(500).json({ error: 'Lỗi server', details: err.message });
  }
});

// Endpoint chat với hỗ trợ tìm kiếm web
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { messages, chatId } = req.body;
    if (!messages?.length) {
      return res.status(400).json({ error: 'Thiếu messages' });
    }

    const userId = req.user.id;
    let currentChatId = chatId;

    if (!currentChatId) {
      const newChatId = uuidv4();
      const { error: insertError } = await supabase
        .from('chats')
        .insert([{
          id: newChatId,
          user_id: userId,
          title: messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? '...' : ''),
          last_message: messages[0].content,
          timestamp: new Date().toISOString()
        }]);

      if (insertError) {
        console.error('Lỗi Supabase thêm chat:', insertError);
        return res.status(500).json({ error: 'Lỗi tạo chat mới', details: insertError.message });
      }
      currentChatId = newChatId;
    } else {
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', currentChatId)
        .eq('user_id', userId)
        .single();

      if (chatError || !chat) {
        console.error('Lỗi Supabase kiểm tra chat:', chatError);
        return res.status(404).json({ error: 'Không tìm thấy chat' });
      }
    }

    const recentMessages = messages.slice(-15);
    let formattedMessages = [
      {
        role: 'system',
        content: 'Bạn là Hein, một trợ lý AI vui tính và hữu ích từ Hein AI. Hãy trả lời tự nhiên bằng ngôn ngữ của người dùng (ví dụ: tiếng Việt nếu người dùng nói tiếng Việt). Sử dụng emoji khi phù hợp 😄. Dùng công cụ web_search khi cần thông tin thời gian thực, sự kiện hiện tại, hoặc khi người dùng yêu cầu tìm kiếm web.'
      },
      ...recentMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))
    ];

    const tools = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Tìm kiếm trên internet để lấy thông tin thời gian thực, dữ liệu hiện tại, hoặc khi cần trả lời các câu hỏi yêu cầu kiến thức cập nhật.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Câu truy vấn để gửi tới công cụ tìm kiếm.'
              }
            },
            required: ['query']
          }
        }
      }
    ];

    let openRouterResponse = await retryAPICall(() =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hein-ai.com',
          'X-Title': 'Hein AI',
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: formattedMessages,
          tools: tools,
          temperature: 0.7,
          max_tokens: 1000,
          stream: false,
        }),
      })
    );

    if (!openRouterResponse) {
      return res.status(499).json({ error: 'Yêu cầu bị hủy bởi người dùng' });
    }

    if (!openRouterResponse.ok) {
      const errorData = await openRouterResponse.json().catch(() => ({}));
      console.error('Lỗi OpenRouter API:', errorData);
      return res.status(500).json({ 
        error: 'Lỗi API OpenRouter', 
        details: errorData.error?.message || 'Lỗi không xác định' 
      });
    }

    let data = await openRouterResponse.json();
    let aiMessage = data.choices[0].message.content;
    const messageId = uuidv4();

    if (data.choices[0].finish_reason === 'tool_calls' && data.choices[0].message.tool_calls) {
      const toolCalls = data.choices[0].message.tool_calls;

      formattedMessages.push(data.choices[0].message);

      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'web_search') {
          let args;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (parseErr) {
            console.error('Lỗi phân tích tham số công cụ:', parseErr.message);
            continue;
          }

          const searchResults = await webSearch(args.query);

          formattedMessages.push({
            role: 'tool',
            content: JSON.stringify({ results: searchResults }),
            tool_call_id: toolCall.id,
            name: 'web_search'
          });
        }
      }

      const toolResponse = await retryAPICall(() =>
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://hein-ai.com',
            'X-Title': 'Hein AI',
          },
          body: JSON.stringify({
            model: 'x-ai/grok-4-fast:free',
            messages: formattedMessages,
            tools: tools,
            temperature: 0.7,
            max_tokens: 1000,
            stream: false,
          }),
        })
      );

      if (!toolResponse) {
        return res.status(499).json({ error: 'Yêu cầu bị hủy bởi người dùng' });
      }

      if (!toolResponse.ok) {
        const errorData = await toolResponse.json().catch(() => ({}));
        console.error('Lỗi phản hồi công cụ OpenRouter:', errorData);
        return res.status(500).json({ 
          error: 'Lỗi phản hồi công cụ OpenRouter', 
          details: errorData.error?.message || 'Lỗi không xác định' 
        });
      }

      const toolData = await toolResponse.json();
      aiMessage = toolData.choices[0].message.content;
    }

    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg.role === 'user') {
      await supabase
        .from('messages')
        .insert([{ 
          id: uuidv4(),
          chat_id: currentChatId, 
          role: 'user', 
          content: lastUserMsg.content, 
          timestamp: new Date().toISOString() 
        }]);
    }

    await supabase
      .from('messages')
      .insert([{ 
        id: messageId,
        chat_id: currentChatId, 
        role: 'ai', 
        content: aiMessage, 
        timestamp: new Date().toISOString() 
      }]);

    await supabase
      .from('chats')
      .update({
        last_message: aiMessage.slice(0, 50) + (aiMessage.length > 50 ? '...' : ''),
        timestamp: new Date().toISOString()
      })
      .eq('id', currentChatId);

    res.json({
      message: aiMessage,
      messageId,
      timestamp: new Date().toISOString(),
      model: 'grok-4-fast-free',
      chatId: currentChatId
    });
  } catch (error) {
    console.error('Lỗi API Chat:', error);
    res.status(500).json({ error: 'Lỗi xử lý tin nhắn', details: error.message });
  }
});

// Endpoint tạo ảnh với Pollinations.ai
app.post('/api/generate-image', authenticateToken, async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt là bắt buộc' });
    if (prompt.length > 500) return res.status(400).json({ error: 'Prompt quá dài, tối đa 500 ký tự' });

    const userId = req.user.id;
    let currentChatId = chatId;

    if (!currentChatId) {
      const newChatId = uuidv4();
      const { error: insertError } = await supabase
        .from('chats')
        .insert([{
          id: newChatId,
          user_id: userId,
          title: prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
          last_message: prompt,
          timestamp: new Date().toISOString()
        }]);

      if (insertError) {
        console.error('Lỗi Supabase thêm chat hình ảnh:', insertError);
        return res.status(500).json({ error: 'Lỗi tạo chat mới', details: insertError.message });
      }
      currentChatId = newChatId;
    } else {
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', currentChatId)
        .eq('user_id', userId)
        .single();

      if (chatError || !chat) {
        console.error('Lỗi Supabase kiểm tra chat hình ảnh:', chatError);
        return res.status(404).json({ error: 'Không tìm thấy chat' });
      }
    }

    const translatedPrompt = await translateToEnglish(prompt);
    console.log('Pollinations.ai API Request - Prompt:', translatedPrompt);

    const encodedPrompt = encodeURIComponent(translatedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&safe=true`;

    const pollinationsResponse = await retryAPICall(() =>
      fetch(imageUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
    );

    if (!pollinationsResponse) {
      return res.status(499).json({ error: 'Yêu cầu tạo ảnh bị hủy bởi người dùng' });
    }

    if (!pollinationsResponse.ok) {
      console.error('Lỗi Pollinations.ai API:', {
        status: pollinationsResponse.status,
        statusText: pollinationsResponse.statusText
      });
      return res.status(pollinationsResponse.status).json({
        error: 'Lỗi tạo ảnh từ Pollinations.ai',
        details: pollinationsResponse.statusText
      });
    }

    const messageId = uuidv4();
    await supabase
      .from('messages')
      .insert([
        { 
          id: uuidv4(),
          chat_id: currentChatId, 
          role: 'user', 
          content: prompt, 
          timestamp: new Date().toISOString() 
        },
        { 
          id: messageId,
          chat_id: currentChatId, 
          role: 'ai', 
          content: `<img src="${imageUrl}" alt="Generated Image" />`, 
          timestamp: new Date().toISOString() 
        }
      ]);

    await supabase
      .from('chats')
      .update({
        last_message: 'Hình ảnh đã tạo',
        timestamp: new Date().toISOString()
      })
      .eq('id', currentChatId);

    res.json({
      message: `<img src="${imageUrl}" alt="Generated Image" />`,
      messageId,
      timestamp: new Date().toISOString(),
      chatId: currentChatId
    });
  } catch (error) {
    console.error('Lỗi tạo ảnh:', error);
    res.status(500).json({ error: 'Lỗi tạo ảnh', details: error.message });
  }
});

// Endpoint xóa chat
app.delete('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', userId)
      .single();

    if (chatError || !chat) {
      console.error('Lỗi Supabase kiểm tra chat:', chatError);
      return res.status(404).json({ error: 'Không tìm thấy chat' });
    }

    const { error: deleteError } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId);

    if (deleteError) {
      console.error('Lỗi Supabase xóa chat:', deleteError);
      return res.status(500).json({ error: 'Lỗi xóa chat', details: deleteError.message });
    }

    await supabase
      .from('messages')
      .delete()
      .eq('chat_id', chatId);

    res.json({ message: 'Chat đã được xóa thành công' });
  } catch (err) {
    console.error('Lỗi xóa chat:', err);
    res.status(500).json({ error: 'Lỗi server', details: err.message });
  }
});

// Endpoint xóa tin nhắn
app.delete('/api/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('chat_id')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      console.error('Lỗi Supabase kiểm tra tin nhắn:', messageError);
      return res.status(404).json({ error: 'Không tìm thấy tin nhắn' });
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', message.chat_id)
      .eq('user_id', userId)
      .single();

    if (chatError || !chat) {
      console.error('Lỗi Supabase kiểm tra chat:', chatError);
      return res.status(404).json({ error: 'Không tìm thấy chat liên quan' });
    }

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (deleteError) {
      console.error('Lỗi Supabase xóa tin nhắn:', deleteError);
      return res.status(500).json({ error: 'Lỗi xóa tin nhắn', details: deleteError.message });
    }

    res.json({ message: 'Tin nhắn đã được xóa thành công' });
  } catch (err) {
    console.error('Lỗi xóa tin nhắn:', err);
    res.status(500).json({ error: 'Lỗi server', details: err.message });
  }
});

// Khởi động server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
