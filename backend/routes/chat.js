import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      error: "Không có token", 
      details: "Vui lòng đăng nhập để tiếp tục" 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ 
      error: "Token không hợp lệ", 
      details: "Vui lòng đăng nhập lại" 
    });
  }
};

// Validation middleware
const validateChatMessage = (req, res, next) => {
  const { message } = req.body;
  
  if (!message || !message.trim()) {
    return res.status(400).json({ 
      error: "Thiếu tin nhắn", 
      details: "Vui lòng nhập tin nhắn để gửi" 
    });
  }

  if (message.trim().length > 1000) {
    return res.status(400).json({ 
      error: "Tin nhắn quá dài", 
      details: "Tin nhắn không được vượt quá 1000 ký tự" 
    });
  }

  next();
};

// Chat endpoint
router.post('/message', authenticateToken, validateChatMessage, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.id;

    // TODO: Integrate with real AI API (OpenAI, Grok, etc.)
    // For now, return a mock response
    const responses = [
      `Xin chào! Tôi là AI assistant. Bạn đã hỏi: "${message.trim()}". Tôi đang trong quá trình phát triển và sẽ sớm có thể trả lời chi tiết hơn.`,
      `Cảm ơn bạn đã gửi tin nhắn: "${message.trim()}". Hiện tại tôi đang học hỏi và sẽ cải thiện khả năng trả lời của mình.`,
      `Tôi đã nhận được câu hỏi của bạn: "${message.trim()}". Đây là một tính năng đang được phát triển và sẽ sớm hoàn thiện.`,
      `Thú vị! Bạn hỏi về: "${message.trim()}". Tôi đang được huấn luyện để có thể trả lời tốt hơn trong tương lai.`
    ];

    // Random response for demo
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    res.json({
      message: randomResponse,
      timestamp: new Date().toISOString(),
      userId: userId
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ 
      error: "Lỗi server", 
      details: "Không thể xử lý tin nhắn. Vui lòng thử lại sau." 
    });
  }
});

// Get chat history (placeholder for future implementation)
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // TODO: Implement chat history storage and retrieval
    res.json({
      messages: [],
      message: "Lịch sử chat sẽ được lưu trữ trong tương lai"
    });

  } catch (err) {
    console.error('Get chat history error:', err);
    res.status(500).json({ 
      error: "Lỗi server", 
      details: "Không thể lấy lịch sử chat" 
    });
  }
});

export default router;
