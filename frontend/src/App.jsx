import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './Login';
import Chat from './Chat';

function App() {
  return (
    <BrowserRouter basename="/"> {/* Đặt basename="/test" nếu deploy dưới /test */}
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/chat/:chatId" element={<Chat />} /> {/* Route động cho chat */}
        <Route path="/home" element={<Login />} />
        <Route path="/settings" element={<Login />} />
        <Route path="*" element={<div>404 - Không tìm thấy trang</div>} /> {/* Route fallback */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
