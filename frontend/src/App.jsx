import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Chat from './Chat.jsx';
import Home from './Home.jsx';
import Login from './Login.jsx';
import Settings from './settings.jsx';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<div>404 - Không tìm thấy trang</div>} />
      </Routes>
    </Router>
  );
}