// src/App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './Login';
import Chat from './Chat';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/home" element={<Login />} /> {/* Add if /home is needed */}
        <Route path="/settings" element={<Login />} /> {/* Add if /settings is needed */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
