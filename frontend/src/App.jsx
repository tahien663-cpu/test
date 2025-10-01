import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './Login';
import Chat from './Chat';

function App() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/chat/:chatId" element={<Chat />} />
        <Route path="/home" element={<Login />} />
        <Route path="/settings" element={<Login />} />
        <Route path="*" element={<Login />} /> {/* Fallback về Login */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
