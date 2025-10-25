import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';
import { FaPaperPlane, FaUsers, FaCircle } from 'react-icons/fa';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState(null);
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('general');
  const [isJoined, setIsJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [memberCount, setMemberCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnectionStatus('connected');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnectionStatus('disconnected');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionStatus('error');
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('user:join:success', ({ memberCount }) => {
      setIsJoined(true);
      setMemberCount(memberCount);
    });

    socket.on('user:joined', ({ username, memberCount, timestamp }) => {
      setMemberCount(memberCount);
      setMessages(prev => [...prev, {
        type: 'system',
        message: `${username} joined the room`,
        timestamp
      }]);
    });

    socket.on('user:left', ({ username, memberCount, timestamp }) => {
      setMemberCount(memberCount);
      setMessages(prev => [...prev, {
        type: 'system',
        message: `${username} left the room`,
        timestamp
      }]);
    });

    socket.on('message:received', (messageData) => {
      setMessages(prev => [...prev, {
        type: 'message',
        ...messageData
      }]);
    });

    socket.on('messages:history:success', (history) => {
      setMessages(history.map(msg => ({ type: 'message', ...msg })));
    });

    socket.on('typing:user', ({ username, isTyping }) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        if (isTyping) {
          newSet.add(username);
        } else {
          newSet.delete(username);
        }
        return newSet;
      });
    });

    socket.on('error', ({ message }) => {
      console.error('Socket error:', message);
      alert(`Error: ${message}`);
    });

    return () => {
      socket.off('user:join:success');
      socket.off('user:joined');
      socket.off('user:left');
      socket.off('message:received');
      socket.off('messages:history:success');
      socket.off('typing:user');
      socket.off('error');
    };
  }, [socket]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleJoin = (e) => {
    e.preventDefault();
    if (socket && username.trim() && room.trim()) {
      socket.emit('user:join', { username: username.trim(), room: room.trim() });
      socket.emit('messages:history', { room: room.trim() });
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (socket && inputMessage.trim()) {
      socket.emit('message:send', {
        message: inputMessage.trim(),
        room
      });
      setInputMessage('');
      socket.emit('typing:stop', { room });
    }
  };

  const handleTyping = (e) => {
    setInputMessage(e.target.value);
    
    if (socket && e.target.value) {
      socket.emit('typing:start', { room });
      
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing:stop', { room });
      }, 1000);
    } else if (socket) {
      socket.emit('typing:stop', { room });
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  if (!isJoined) {
    return (
      <div className="app">
        <div className="join-container">
          <div className="join-card">
            <h1 className="app-title">
              <FaCircle className="status-icon" /> Scalable Chat
            </h1>
            <p className="app-subtitle">Real-time messaging with Redis & Socket.io</p>
            
            <div className="status-badge" data-status={connectionStatus}>
              <FaCircle className="status-dot" />
              {connectionStatus === 'connected' && 'Connected'}
              {connectionStatus === 'disconnected' && 'Disconnected'}
              {connectionStatus === 'error' && 'Connection Error'}
            </div>

            <form onSubmit={handleJoin} className="join-form">
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  maxLength={20}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Room</label>
                <input
                  type="text"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  placeholder="Enter room name"
                  required
                  maxLength={30}
                />
              </div>

              <button 
                type="submit" 
                className="join-button"
                disabled={connectionStatus !== 'connected'}
              >
                Join Chat Room
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="chat-container">
        <div className="chat-header">
          <div className="header-left">
            <h2>#{room}</h2>
            <span className="member-count">
              <FaUsers /> {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </span>
          </div>
          <div className="header-right">
            <div className="status-badge" data-status={connectionStatus}>
              <FaCircle className="status-dot" />
              {connectionStatus === 'connected' && 'Connected'}
            </div>
            <span className="username-badge">{username}</span>
          </div>
        </div>

        <div className="messages-container">
          <div className="messages-list">
            {messages.map((msg, index) => (
              <div 
                key={msg.id || index} 
                className={`message ${msg.type} ${msg.username === username ? 'own-message' : ''}`}
              >
                {msg.type === 'system' ? (
                  <div className="system-message">
                    <span>{msg.message}</span>
                  </div>
                ) : (
                  <div className="message-content">
                    <div className="message-header">
                      <span className="message-username">{msg.username}</span>
                      <span className="message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                    <div className="message-text">{msg.message}</div>
                  </div>
                )}
              </div>
            ))}
            
            {typingUsers.size > 0 && (
              <div className="typing-indicator">
                <span>{Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...</span>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="message-input-container">
          <form onSubmit={handleSendMessage} className="message-form">
            <input
              type="text"
              value={inputMessage}
              onChange={handleTyping}
              placeholder="Type a message..."
              className="message-input"
              disabled={connectionStatus !== 'connected'}
            />
            <button 
              type="submit" 
              className="send-button"
              disabled={!inputMessage.trim() || connectionStatus !== 'connected'}
            >
              <FaPaperPlane />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
