import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Validation middleware
const validateRegister = (req, res, next) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ 
      error: "Thiếu thông tin", 
      details: "Vui lòng điền đầy đủ họ tên, email và mật khẩu" 
    });
  }

  if (password.length < 6) {
    return res.status(400).json({ 
      error: "Mật khẩu quá ngắn", 
      details: "Mật khẩu phải có ít nhất 6 ký tự" 
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      error: "Email không hợp lệ", 
      details: "Vui lòng nhập email đúng định dạng" 
    });
  }

  next();
};

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ 
      error: "Thiếu thông tin", 
      details: "Vui lòng điền đầy đủ email và mật khẩu" 
    });
  }

  next();
};

// Register endpoint
router.post('/register', validateRegister, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(409).json({ 
        error: "Email đã tồn tại", 
        details: "Vui lòng sử dụng email khác hoặc đăng nhập" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{
        id: randomUUID(),
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        created_at: new Date().toISOString()
      }])
      .select('id, name, email, created_at')
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: newUser.id, 
        email: newUser.email,
        name: newUser.name
      },
      process.env.JWT_SECRET || "SECRET_KEY",
      { expiresIn: "24h" }
    );

    res.status(201).json({
      message: "Đăng ký thành công",
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email
      }
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ 
      error: "Lỗi server", 
      details: "Không thể tạo tài khoản. Vui lòng thử lại sau." 
    });
  }
});

// Login endpoint
router.post('/login', validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return res.status(401).json({ 
        error: "Thông tin đăng nhập không đúng", 
        details: "Email hoặc mật khẩu không chính xác" 
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ 
        error: "Thông tin đăng nhập không đúng", 
        details: "Email hoặc mật khẩu không chính xác" 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        name: user.name
      },
      process.env.JWT_SECRET || "SECRET_KEY",
      { expiresIn: "24h" }
    );

    res.json({
      message: "Đăng nhập thành công",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ 
      error: "Lỗi server", 
      details: "Không thể đăng nhập. Vui lòng thử lại sau." 
    });
  }
});

// Verify token endpoint
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: "Không có token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
    
    // Get fresh user data
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, created_at')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "Người dùng không tồn tại" });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (err) {
    res.status(401).json({ error: "Token không hợp lệ" });
  }
});

export default router;
