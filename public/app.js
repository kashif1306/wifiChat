// P2P WebChat Client Application
class P2PWebChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.peers = new Map();
        this.rooms = new Map();
        this.peerConnections = new Map();
        this.dataChannels = new Map();
        this.fileTransfers = new Map();
        this.currentChat = null;
        this.notificationSoundEnabled = true;
        
        // WebRTC Configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.init();
    }

    buildPreviewHtml(message) {
        if (!message.preview) return '';
        const p = message.preview;
        if (p.type && p.url) {
            if (p.type.startsWith('image/')) {
                return `<div class="preview"><img src="${p.url}" alt="image"/></div>`;
            } else if (p.type.startsWith('video/')) {
                return `<div class="preview"><video controls src="${p.url}"></video></div>`;
            } else if (p.type.startsWith('audio/')) {
                return `<div class="preview"><audio controls src="${p.url}"></audio></div>`;
            } else if (p.type.startsWith('text/')) {
                return `<div class="preview"><iframe src="${p.url}" style="width:260px;height:160px;border:none;border-radius:8px;background:#111"></iframe></div>`;
            }
        }
        return '';
    }

    populateEmojiPicker(container) {
        const emojis = [
            '😀','😃','😄','😁','😆','😅','😂','🤣','🥲','☺️','😊','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🫠','🫡','🤗','🤭','🤫','🤔','😐','😑','😶','🫥','😶‍🌫️','🙄','😬','😮‍💨','🤥','😌','😴','🤤','😪','😮','😯','😲','🥱','😧','😦','😨','😰','😥','😢','😭','😱','😳','🤯','🥵','🥶','😶‍🌫️','😡','😠','🤬','😤','👍','👎','👏','🙏','🔥','💯','🎉','❤️','💙','💚','💛','💜','🖤','🤍','🤎'
        ];
        emojis.forEach(e => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = e;
            btn.addEventListener('click', () => {
                const input = document.getElementById('messageInput');
                const start = input.selectionStart || input.value.length;
                const before = input.value.substring(0, start);
                const after = input.value.substring(start);
                input.value = before + e + after;
                input.focus();
                input.selectionStart = input.selectionEnd = start + e.length;
            });
            container.appendChild(btn);
        });
    }

    init() {
        this.initializeIndexedDB();
        this.checkSession();
        this.setupEventListeners();
        this.requestNotificationPermission();
    }

    onReact(messageId, emoji) {
        const action = 'toggle';
        if (this.currentChat.type === 'peer') {
            const dc = this.dataChannels.get(this.currentChat.id);
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'reaction', data: { messageId, emoji, action, userId: this.currentUser.userId } }));
            }
            this.applyReaction(messageId, emoji, this.currentUser.userId, action);
        } else if (this.currentChat.type === 'room') {
            this.socket.emit('room:reaction', { roomId: this.currentChat.id, messageId, emoji, action });
            this.applyReaction(messageId, emoji, this.currentUser.userId, action);
        }
    }

    applyReaction(messageId, emoji, userId, action) {
        const container = document.getElementById(`reactions-${messageId}`);
        if (!container) return;
        const key = `${emoji}`;
        let countEl = container.querySelector(`[data-emoji="${key}"]`);
        if (!countEl) {
            countEl = document.createElement('span');
            countEl.className = 'reaction-count';
            countEl.dataset.emoji = key;
            countEl.dataset.count = '0';
            countEl.textContent = `${emoji} 0`;
            container.appendChild(countEl);
        }
        let count = parseInt(countEl.dataset.count || '0', 10);
        if (action === 'toggle') {
            count = count + 1;
        }
        countEl.dataset.count = String(count);
        countEl.textContent = `${emoji} ${count}`;
    }

    // Session Management
    checkSession() {
        const session = localStorage.getItem('p2p_session');
        if (session) {
            const sessionData = JSON.parse(session);
            const now = new Date().getTime();
            
            if (sessionData.expiry > now) {
                this.currentUser = sessionData;
                this.showApp();
                this.connectToServer();
                return;
            }
        }
        this.showUserSetup();
    }

    saveSession(userData) {
        const expiry = new Date().getTime() + (30 * 60 * 1000); // 30 minutes
        const sessionData = { ...userData, expiry };
        localStorage.setItem('p2p_session', JSON.stringify(sessionData));
        this.currentUser = sessionData;
    }

    // UI Management
    showUserSetup() {
        document.getElementById('userSetupModal').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
    }

    showApp() {
        document.getElementById('userSetupModal').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        document.getElementById('currentUserName').textContent = this.currentUser.name;
        if (this.currentUser.avatarUrl) {
            const avatar = document.getElementById('currentUserAvatar');
            avatar.style.backgroundImage = `url('${this.currentUser.avatarUrl}')`;
        } else {
            const avatar = document.getElementById('currentUserAvatar');
            avatar.style.backgroundImage = '';
        }
        document.body.classList.toggle('light', !!this.currentUser.lightTheme);
    }

    // Socket.IO Connection
    connectToServer() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.updateConnectionStatus(true);
            this.socket.emit('user:join', {
                name: this.currentUser.name,
                userId: this.currentUser.userId,
                avatarUrl: this.currentUser.avatarUrl
            });
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus(false);
        });

        this.socket.on('user:joined', (data) => {
            this.currentUser.userId = data.userId;
            this.saveSession(this.currentUser);
        });

        this.socket.on('user:list', (users) => {
            this.updatePeersList(users);
        });

        this.socket.on('room:list', (rooms) => {
            this.updateRoomsList(rooms);
        });

        this.socket.on('room:created', (data) => {
            this.showNotification('Room created successfully', 'success');
            this.hideRoomModal();
            // Auto-join the created room
            setTimeout(() => {
                this.joinRoom(data.roomId);
            }, 500);
        });

        this.socket.on('room:joined', (data) => {
            this.showNotification(`Joined room: ${data.room.name}`, 'success');
            // Auto-open room chat
            setTimeout(() => {
                this.startRoomChat(data.roomId);
            }, 300);
        });

        this.socket.on('room:kicked', (data) => {
            this.showNotification('You were removed from the room', 'warning');
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.closeChat();
            }
        });

        this.socket.on('room:left', (data) => {
            this.showNotification('Left room successfully', 'success');
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.closeChat();
            }
        });

        this.socket.on('error', (data) => {
            this.showNotification(data.message, 'error');
        });

        // WebRTC Signaling
        this.socket.on('signal:offer', (data) => {
            this.handleWebRTCOffer(data);
        });

        this.socket.on('signal:answer', (data) => {
            this.handleWebRTCAnswer(data);
        });

        this.socket.on('signal:ice', (data) => {
            this.handleWebRTCIce(data);
        });

        this.socket.on('room:update', (data) => {
            // Update room in local storage
            this.rooms.set(data.roomId, data.room);
            this.updateRoomsList(Array.from(this.rooms.values()));
        });

        // Room typing indicator
        this.socket.on('room:typing', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.showTyping(true, data.userId);
                clearTimeout(this.typingTimeout);
                this.typingTimeout = setTimeout(() => this.showTyping(false), 1500);
            }
        });

        // File Transfer Fallback
        this.socket.on('file:start', (data) => {
            this.handleFileTransferStart(data);
        });

        this.socket.on('file:chunk', (data) => {
            this.handleFileTransferChunk(data);
        });

        this.socket.on('file:end', (data) => {
            this.handleFileTransferEnd(data);
        });

        // Room message handling
        this.socket.on('room:message', (data) => {
            // Always save the message, regardless of chat panel state
            this.saveChatMessage(data.roomId, data.message);
            
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                // Display message if chat is currently open
                this.displayMessage(data.message, false);
            } else {
                // Handle background message
                this.handleBackgroundMessage('room', data.roomId, data.message);
            }
            
            // Always show notification
            const roomName = this.rooms.get(data.roomId)?.name || 'room';
            this.showNotificationAlert(`New message in ${roomName}`, data.message.text, () => {
                this.startRoomChat(data.roomId);
            });
        });

        this.socket.on('room:message-edit', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.applyMessageEdit(data.messageId, data.newText);
            }
        });

        this.socket.on('room:message-delete', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.applyMessageDelete(data.messageId);
            }
        });

        this.socket.on('room:reaction', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.applyReaction(data.messageId, data.emoji, data.userId, data.action);
            }
        });
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connectionStatus');
        indicator.classList.toggle('disconnected', !connected);
    }

    // Event Listeners Setup
    setupEventListeners() {
        // User Setup
        document.getElementById('joinNetworkBtn').addEventListener('click', () => {
            const name = document.getElementById('displayNameInput').value.trim();
            const avatarUrl = document.getElementById('avatarUrlInput').value.trim();
            const lightTheme = document.getElementById('themeToggleInput').checked;
            if (name) {
                this.saveSession({ name, avatarUrl, lightTheme });
                this.showApp();
                this.connectToServer();
            }
        });

        // Tab Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Room Creation
        document.getElementById('createPublicRoomBtn').addEventListener('click', () => {
            this.showRoomModal(false);
        });

        document.getElementById('createPrivateRoomBtn').addEventListener('click', () => {
            this.showRoomModal(true);
        });

        document.getElementById('createRoomBtn').addEventListener('click', () => {
            this.createRoom();
        });

        document.getElementById('cancelRoomBtn').addEventListener('click', () => {
            this.hideRoomModal();
        });

        // Private Room Join
        document.getElementById('joinPrivateRoomBtn').addEventListener('click', () => {
            const pin = document.getElementById('privateRoomPin').value;
            if (pin && pin.length === 4) {
                // Find private room and join
                this.joinRoomWithPin(pin);
            }
        });

        // Chat
        document.getElementById('closeChatBtn').addEventListener('click', () => {
            this.closeChat();
        });

        document.getElementById('sendMessageBtn').addEventListener('click', () => {
            this.sendMessage();
        });

        const msgInput = document.getElementById('messageInput');
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
            this.emitTyping();
        });

        // File Upload
        document.getElementById('attachFileBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                Array.from(e.target.files).forEach(file => {
                    this.sendFile(file);
                });
                e.target.value = '';
            }
        });

        // Emoji picker
        const emojiBtn = document.getElementById('emojiBtn');
        const emojiPicker = document.getElementById('emojiPicker');
        if (emojiBtn && emojiPicker) {
            emojiBtn.addEventListener('click', () => {
                if (emojiPicker.childElementCount === 0) {
                    this.populateEmojiPicker(emojiPicker);
                }
                emojiPicker.classList.toggle('hidden');
                // Position picker near the button
                const rect = emojiBtn.getBoundingClientRect();
                const panelRect = document.getElementById('chatPanel').getBoundingClientRect();
                emojiPicker.style.right = `${Math.max(20, panelRect.right - rect.right)}px`;
            });
            document.addEventListener('click', (e) => {
                if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
                    emojiPicker.classList.add('hidden');
                }
            });
        }

        // Peer Search
        document.getElementById('peerSearchInput').addEventListener('input', (e) => {
            this.filterPeers(e.target.value);
        });

        // Theme toggle button
        const themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                const isLight = !document.body.classList.contains('light');
                document.body.classList.toggle('light', isLight);
                this.currentUser.lightTheme = isLight;
                this.saveSession(this.currentUser);
            });
        }

        // Edit profile
        const editBtn = document.getElementById('editProfileBtn');
        const editModal = document.getElementById('editProfileModal');
        if (editBtn && editModal) {
            const open = () => {
                document.getElementById('editNameInput').value = this.currentUser.name || '';
                document.getElementById('editAvatarInput').value = this.currentUser.avatarUrl || '';
                editModal.classList.remove('hidden');
            };
            const close = () => editModal.classList.add('hidden');
            editBtn.addEventListener('click', open);
            document.getElementById('cancelEditProfileBtn').addEventListener('click', close);
            document.getElementById('saveEditProfileBtn').addEventListener('click', () => {
                const newName = document.getElementById('editNameInput').value.trim();
                const newAvatar = document.getElementById('editAvatarInput').value.trim();
                if (!newName) {
                    this.showNotification('Name cannot be empty', 'error');
                    return;
                }
                this.currentUser.name = newName;
                this.currentUser.avatarUrl = newAvatar;
                this.saveSession(this.currentUser);
                document.getElementById('currentUserName').textContent = newName;
                const avatar = document.getElementById('currentUserAvatar');
                avatar.style.backgroundImage = newAvatar ? `url('${newAvatar}')` : '';
                this.socket.emit('user:update', { name: newName, avatarUrl: newAvatar });
                close();
            });
        }
    }

    // Tab Management
    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
    }

    // Room Management
    showRoomModal(isPrivate) {
        document.getElementById('roomModal').classList.remove('hidden');
        document.getElementById('roomModalTitle').textContent = 
            isPrivate ? 'Create Private Room' : 'Create Public Room';
        document.getElementById('pinSection').classList.toggle('hidden', !isPrivate);
        document.getElementById('roomNameInput').value = '';
        document.getElementById('roomPinInput').value = '';
        document.getElementById('roomNameInput').focus();
    }

    hideRoomModal() {
        document.getElementById('roomModal').classList.add('hidden');
    }

    createRoom() {
        const name = document.getElementById('roomNameInput').value.trim();
        const isPrivate = !document.getElementById('pinSection').classList.contains('hidden');
        const pin = document.getElementById('roomPinInput').value;

        if (!name) {
            this.showNotification('Please enter a room name', 'error');
            return;
        }

        if (isPrivate && (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin))) {
            this.showNotification('Please enter a 4-digit numeric PIN', 'error');
            return;
        }

        this.socket.emit('room:create', { name, isPrivate, pin });
        // UX: show creating feedback
        this.showNotification(isPrivate ? 'Creating private room…' : 'Creating public room…', 'info');
    }

    joinRoom(roomId, pin = null) {
        this.socket.emit('room:join', { roomId, pin });
    }

    joinRoomWithPin(pin) {
        this.socket.emit('room:joinByPin', { pin });
    }

    // Peer and Room List Updates
    updatePeersList(users) {
        const container = document.getElementById('peersList');
        container.innerHTML = '';

        const filteredUsers = users.filter(user => user.id !== this.currentUser.userId);
        
        filteredUsers.forEach(user => {
            const tile = this.createPeerTile(user);
            container.appendChild(tile);
        });

        this.peers.clear();
        users.forEach(user => {
            this.peers.set(user.id, user);
        });
        
        // Update lobby stats and connections
        this.updateLobbyStats();
        this.updateActiveConnections(filteredUsers);
    }

    updateRoomsList(rooms) {
        const publicContainer = document.getElementById('publicRoomsList');
        const privateContainer = document.getElementById('privateRoomsList');
        
        publicContainer.innerHTML = '';
        privateContainer.innerHTML = '';

        rooms.forEach(room => {
            const tile = this.createRoomTile(room);
            if (room.isPrivate) {
                privateContainer.appendChild(tile);
            } else {
                publicContainer.appendChild(tile);
            }
        });

        this.rooms.clear();
        rooms.forEach(room => {
            this.rooms.set(room.id, room);
        });
        
        // Update lobby with joined rooms
        this.updateMyRooms();
        this.updateLobbyStats();
    }

    createPeerTile(user) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.innerHTML = `
            <div class="tile-header">
                <span class="tile-title">${this.escapeHtml(user.name)}</span>
                <span class="connection-status"></span>
            </div>
            <div class="tile-info">ID: ${user.id.substring(0, 8)}...</div>
            <div class="tile-actions">
                <button class="tile-btn" onclick="app.startChat('${user.id}')">Chat</button>
            </div>
        `;
        return tile;
    }

    createRoomTile(room) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        
        const isLead = room.leadUserId === this.currentUser.userId;
        const isMember = room.members.some(m => m.id === this.currentUser.userId);
        
        tile.innerHTML = `
            <div class="tile-header">
                <span class="tile-title">${this.escapeHtml(room.name)}</span>
                <span class="tile-badge ${room.isPrivate ? 'private' : ''}">${room.isPrivate ? 'Private' : 'Public'}</span>
            </div>
            <div class="tile-info">${room.members.length} member(s) ${isMember ? '• Joined' : ''}</div>
            <div class="tile-actions">
                ${!isMember ? `<button class="tile-btn" onclick="app.joinRoom('${room.id}')">Join</button>` : ''}
                ${isMember ? `<button class="tile-btn" onclick="app.startRoomChat('${room.id}')">Open Chat</button>` : ''}
                ${isLead && isMember ? `<button class="tile-btn danger" onclick="app.leaveRoom('${room.id}')">Leave</button>` : ''}
            </div>
        `;
        return tile;
    }

    filterPeers(searchTerm) {
        const tiles = document.querySelectorAll('#peersList .tile');
        tiles.forEach(tile => {
            const title = tile.querySelector('.tile-title').textContent.toLowerCase();
            const info = tile.querySelector('.tile-info').textContent.toLowerCase();
            const matches = title.includes(searchTerm.toLowerCase()) || info.includes(searchTerm.toLowerCase());
            tile.style.display = matches ? 'block' : 'none';
        });
    }

    // New methods for lobby updates
    updateLobbyStats() {
        const joinedRooms = Array.from(this.rooms.values()).filter(room => 
            room.members.some(m => m.id === this.currentUser.userId)
        );
        const connectedPeers = Array.from(this.peers.values()).filter(user => 
            user.id !== this.currentUser.userId
        );
        
        // Update stat cards
        document.getElementById('roomCount').textContent = joinedRooms.length;
        document.getElementById('peerCount').textContent = connectedPeers.length;
        
        // Update section badges
        document.getElementById('myRoomsBadge').textContent = joinedRooms.length;
        document.getElementById('connectionsBadge').textContent = connectedPeers.length;
        
        // Get message count from localStorage
        const messageCount = this.getTodayMessageCount();
        document.getElementById('messageCount').textContent = messageCount;
    }

    updateMyRooms() {
        const container = document.getElementById('myRooms');
        const emptyState = document.getElementById('emptyRooms');
        
        const joinedRooms = Array.from(this.rooms.values()).filter(room => 
            room.members.some(m => m.id === this.currentUser.userId)
        );
        
        if (joinedRooms.length === 0) {
            emptyState.style.display = 'block';
            // Clear any existing room tiles
            const existingTiles = container.querySelectorAll('.room-tile');
            existingTiles.forEach(tile => tile.remove());
        } else {
            emptyState.style.display = 'none';
            
            // Clear existing tiles
            const existingTiles = container.querySelectorAll('.room-tile');
            existingTiles.forEach(tile => tile.remove());
            
            // Add joined rooms
            joinedRooms.forEach(room => {
                const tile = this.createLobbyRoomTile(room);
                container.appendChild(tile);
            });
        }
    }

    updateActiveConnections(users) {
        const container = document.getElementById('activeConnections');
        const emptyState = document.getElementById('emptyConnections');
        
        if (users.length === 0) {
            emptyState.style.display = 'block';
            // Clear any existing connection items
            const existingItems = container.querySelectorAll('.connection-item');
            existingItems.forEach(item => item.remove());
        } else {
            emptyState.style.display = 'none';
            
            // Clear existing items
            const existingItems = container.querySelectorAll('.connection-item');
            existingItems.forEach(item => item.remove());
            
            // Add active connections
            users.forEach(user => {
                const item = this.createConnectionItem(user);
                container.appendChild(item);
            });
        }
    }

    createLobbyRoomTile(room) {
        const tile = document.createElement('div');
        tile.className = 'room-tile enhanced-tile';
        tile.setAttribute('data-room-id', room.id);
        
        const isLead = room.leadUserId === this.currentUser.userId;
        const lastActivity = this.getLastRoomActivity(room.id);
        
        tile.innerHTML = `
            <div class="tile-header">
                <div class="tile-icon">${room.isPrivate ? '🔒' : '🌐'}</div>
                <div class="tile-content">
                    <div class="tile-title">${this.escapeHtml(room.name)}</div>
                    <div class="tile-subtitle">${room.members.length} members ${isLead ? '• Leader' : ''}</div>
                </div>
                <div class="tile-status ${room.isPrivate ? 'private' : 'public'}">${room.isPrivate ? 'Private' : 'Public'}</div>
            </div>
            <div class="tile-footer">
                <div class="tile-activity">${lastActivity}</div>
                <div class="tile-actions">
                    <button class="tile-btn primary" onclick="app.startRoomChat('${room.id}')">💬 Chat</button>
                    <button class="tile-btn secondary" onclick="app.leaveRoom('${room.id}')">🚪 Leave</button>
                </div>
            </div>
        `;
        return tile;
    }

    createConnectionItem(user) {
        const item = document.createElement('div');
        item.className = 'connection-item';
        item.setAttribute('data-peer-id', user.id);
        
        const connectionStatus = this.peerConnections.has(user.id) ? 'connected' : 'available';
        const lastSeen = this.formatLastSeen(user.joinedAt);
        
        item.innerHTML = `
            <div class="connection-avatar" style="background-image: url('${user.avatarUrl || ''}')">
                ${!user.avatarUrl ? user.name.charAt(0).toUpperCase() : ''}
            </div>
            <div class="connection-info">
                <div class="connection-name">${this.escapeHtml(user.name)}</div>
                <div class="connection-status-text">
                    <span class="status-dot ${connectionStatus}"></span>
                    ${connectionStatus === 'connected' ? 'Connected' : 'Available'} • ${lastSeen}
                </div>
            </div>
            <div class="connection-actions">
                <button class="connection-btn" onclick="app.startChat('${user.id}')" title="Start Chat">💬</button>
                <button class="connection-btn" onclick="app.initWebRTCConnection('${user.id}')" title="Connect">🔗</button>
            </div>
        `;
        return item;
    }

    addRecentActivity(type, description, roomId = null) {
        const container = document.getElementById('recentActivity');
        const emptyState = container.querySelector('.empty-state');
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        const activity = document.createElement('div');
        activity.className = 'activity-item';
        
        const icons = {
            'message': '💬',
            'join': '👋',
            'leave': '👋',
            'room_create': '🏠',
            'file': '📎',
            'connect': '🔗'
        };
        
        activity.innerHTML = `
            <div class="activity-icon">${icons[type] || '📝'}</div>
            <div class="activity-content">
                <div class="activity-title">${this.escapeHtml(description)}</div>
                <div class="activity-time">${this.formatTime(new Date())}</div>
            </div>
        `;
        
        container.insertBefore(activity, container.firstChild);
        
        // Keep only last 10 activities
        const activities = container.querySelectorAll('.activity-item');
        if (activities.length > 10) {
            activities[activities.length - 1].remove();
        }
    }

    getLastRoomActivity(roomId) {
        // This would typically come from stored chat history
        return 'Active now';
    }

    getTodayMessageCount() {
        // Get from localStorage or return 0
        const today = new Date().toDateString();
        const stored = localStorage.getItem(`messageCount_${today}`);
        return stored ? parseInt(stored) : 0;
    }

    incrementMessageCount() {
        const today = new Date().toDateString();
        const current = this.getTodayMessageCount();
        localStorage.setItem(`messageCount_${today}`, (current + 1).toString());
        document.getElementById('messageCount').textContent = current + 1;
    }

    formatLastSeen(joinedAt) {
        const now = new Date();
        const joined = new Date(joinedAt);
        const diff = now - joined;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
    }

    formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Background message handling
    handleBackgroundMessage(type, chatId, message) {
        // Store unread message count
        const key = `unread_${type}_${chatId}`;
        const currentCount = parseInt(localStorage.getItem(key) || '0');
        localStorage.setItem(key, (currentCount + 1).toString());
        
        // Update UI indicators
        this.updateUnreadIndicators();
        
        // Add to recent activity
        const description = type === 'room' 
            ? `New message in ${this.rooms.get(chatId)?.name || 'room'}`
            : `Message from ${this.peers.get(chatId)?.name || 'peer'}`;
        this.addRecentActivity('message', description, chatId);
        
        // Play notification sound if enabled
        this.playNotificationSound();
    }

    // Enhanced notification system
    showNotificationAlert(title, message, onClick = null) {
        // Browser notification if permission granted
        if (Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body: message.substring(0, 100),
                icon: '/favicon.ico',
                tag: 'wifichat-message'
            });
            
            if (onClick) {
                notification.onclick = () => {
                    window.focus();
                    onClick();
                    notification.close();
                };
            }
            
            // Auto close after 5 seconds
            setTimeout(() => notification.close(), 5000);
        }
        
        // In-app notification
        this.showInAppNotification(title, message, onClick);
    }

    showInAppNotification(title, message, onClick = null) {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = 'notification-alert';
        
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-title">${this.escapeHtml(title)}</div>
                <div class="notification-message">${this.escapeHtml(message.substring(0, 100))}</div>
            </div>
            <div class="notification-actions">
                ${onClick ? '<button class="notification-btn primary" data-action="open">Open</button>' : ''}
                <button class="notification-btn secondary" data-action="close">×</button>
            </div>
        `;
        
        // Add event listeners
        const openBtn = notification.querySelector('[data-action="open"]');
        const closeBtn = notification.querySelector('[data-action="close"]');
        
        if (openBtn && onClick) {
            openBtn.addEventListener('click', () => {
                onClick();
                notification.remove();
            });
        }
        
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        container.appendChild(notification);
        
        // Auto remove after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 8000);
    }

    updateUnreadIndicators() {
        // Update room tiles with unread counts
        Array.from(this.rooms.values()).forEach(room => {
            const unreadCount = parseInt(localStorage.getItem(`unread_room_${room.id}`) || '0');
            const tile = document.querySelector(`[data-room-id="${room.id}"]`);
            if (tile) {
                this.updateTileUnreadBadge(tile, unreadCount);
            }
        });
        
        // Update peer tiles with unread counts
        Array.from(this.peers.values()).forEach(peer => {
            const unreadCount = parseInt(localStorage.getItem(`unread_peer_${peer.id}`) || '0');
            const tile = document.querySelector(`[data-peer-id="${peer.id}"]`);
            if (tile) {
                this.updateTileUnreadBadge(tile, unreadCount);
            }
        });
        
        // Update lobby stats
        this.updateLobbyStats();
    }

    updateTileUnreadBadge(tile, count) {
        let badge = tile.querySelector('.unread-badge');
        
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'unread-badge';
                tile.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : count.toString();
            badge.style.display = 'block';
        } else if (badge) {
            badge.style.display = 'none';
        }
    }

    clearUnreadCount(type, chatId) {
        const key = `unread_${type}_${chatId}`;
        localStorage.removeItem(key);
        this.updateUnreadIndicators();
    }

    playNotificationSound() {
        // Create a subtle notification sound
        if (this.notificationSoundEnabled) {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        }
    }

    // Request notification permission on app start
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    this.showNotification('Notifications enabled!', 'success');
                }
            });
        }
    }

    // Chat Management
    startChat(peerId) {
        this.currentChat = { type: 'peer', id: peerId };
        const peer = this.peers.get(peerId);
        
        document.getElementById('chatTitle').textContent = `Chat with ${peer.name}`;
        document.getElementById('chatPanel').classList.remove('hidden');
        
        // Clear unread count when opening chat
        this.clearUnreadCount('peer', peerId);
        
        this.loadChatHistory(peerId);
        this.initWebRTCConnection(peerId);
        
        // Add to recent activity
        this.addRecentActivity('connect', `Started chat with ${peer.name}`);
    }

    startRoomChat(roomId) {
        this.currentChat = { type: 'room', id: roomId };
        const room = this.rooms.get(roomId);
        
        document.getElementById('chatTitle').textContent = `Room: ${room.name}`;
        document.getElementById('chatPanel').classList.remove('hidden');
        
        // Clear unread count when opening chat
        this.clearUnreadCount('room', roomId);
        
        this.loadChatHistory(roomId);
        
        // Add to recent activity
        this.addRecentActivity('join', `Opened room ${room.name}`);
    }

    closeChat() {
        const chatPanel = document.getElementById('chatPanel');
        chatPanel.classList.add('hidden');
        this.currentChat = null;
        
        // Clear chat messages to prevent UI issues
        document.getElementById('chatMessages').innerHTML = '';
        document.getElementById('messageInput').value = '';
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        
        if (!text || !this.currentChat) return;
        
        const message = {
            id: this.generateId(),
            text: text,
            timestamp: new Date().toISOString(),
            userId: this.currentUser.userId,
            userName: this.currentUser.name
        };
        
        // Display message immediately
        this.displayMessage(message, true);
        this.saveChatMessage(this.currentChat.id, message);
        
        // Increment message count
        this.incrementMessageCount();
        
        if (this.currentChat.type === 'peer') {
            this.sendPeerMessage(this.currentChat.id, message);
        } else if (this.currentChat.type === 'room') {
            this.socket.emit('room:message', {
                roomId: this.currentChat.id,
                message: message
            });
        }
        
        input.value = '';
        this.autoResizeTextarea(input);
    }

    displayMessage(message, isSent) {
        const container = document.getElementById('chatMessages');
        const row = document.createElement('div');
        row.className = `msg-row ${isSent ? 'sent' : 'received'}`;

        const bubble = document.createElement('div');
        bubble.className = `message ${isSent ? 'sent' : 'received'}`;
        bubble.dataset.messageId = message.id;

        const previewHtml = this.buildPreviewHtml(message);
        bubble.innerHTML = `
            <div class="message-text">${this.escapeHtml(message.text)}</div>
            ${previewHtml}
            <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
            ${isSent ? `
            <div class="message-actions">
                <button class="message-action-btn" onclick="app.onEditMessage('${message.id}')">Edit</button>
                <button class="message-action-btn" onclick="app.onDeleteMessage('${message.id}')">Delete</button>
            </div>` : ''}
            <div class="reactions" id="reactions-${message.id}">
                <button class="reaction-btn" onclick="app.onReact('${message.id}','👍')">👍</button>
                <button class="reaction-btn" onclick="app.onReact('${message.id}','❤️')">❤️</button>
                <button class="reaction-btn" onclick="app.onReact('${message.id}','😂')">😂</button>
            </div>
        `;

        const avatar = document.createElement('div');
        avatar.className = 'avatar-sm';
        let avatarUrl = null;
        if (!isSent) {
            if (this.currentChat.type === 'peer') {
                const peer = this.peers.get(this.currentChat.id);
                avatarUrl = peer && peer.avatarUrl ? peer.avatarUrl : null;
                avatar.textContent = peer && peer.name ? peer.name.charAt(0).toUpperCase() : '';
            } else if (this.currentChat.type === 'room') {
                avatar.textContent = 'R';
            }
        } else if (this.currentUser && this.currentUser.avatarUrl) {
            avatarUrl = this.currentUser.avatarUrl;
            avatar.textContent = this.currentUser.name ? this.currentUser.name.charAt(0).toUpperCase() : '';
        } else {
            avatar.textContent = this.currentUser && this.currentUser.name ? this.currentUser.name.charAt(0).toUpperCase() : '';
        }
        if (avatarUrl) avatar.style.backgroundImage = `url('${avatarUrl}')`;
        if (isSent) {
            row.appendChild(bubble);
            row.appendChild(avatar);
        } else {
            row.appendChild(avatar);
            row.appendChild(bubble);
        }

        container.appendChild(row);
        container.scrollTop = container.scrollHeight;
    }

    // WebRTC Implementation
    async initWebRTCConnection(peerId) {
        if (this.peerConnections.has(peerId)) return;

        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(peerId, pc);

        // Create data channel
        const dataChannel = pc.createDataChannel('messages', { ordered: true });
        this.setupDataChannel(dataChannel, peerId);

        pc.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, peerId);
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('signal:ice', {
                    targetUserId: peerId,
                    candidate: event.candidate
                });
            }
        };

        // Create offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this.socket.emit('signal:offer', {
                targetUserId: peerId,
                offer: offer
            });
        } catch (error) {
            console.error('Error creating WebRTC offer:', error);
        }
    }

    async handleWebRTCOffer(data) {
        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(data.fromUserId, pc);

        pc.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, data.fromUserId);
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('signal:ice', {
                    targetUserId: data.fromUserId,
                    candidate: event.candidate
                });
            }
        };

        try {
            await pc.setRemoteDescription(data.offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.socket.emit('signal:answer', {
                targetUserId: data.fromUserId,
                answer: answer
            });
        } catch (error) {
            console.error('Error handling WebRTC offer:', error);
        }
    }

    async handleWebRTCAnswer(data) {
        const pc = this.peerConnections.get(data.fromUserId);
        if (pc) {
            try {
                await pc.setRemoteDescription(data.answer);
            } catch (error) {
                console.error('Error handling WebRTC answer:', error);
            }
        }
    }

    async handleWebRTCIce(data) {
        const pc = this.peerConnections.get(data.fromUserId);
        if (pc) {
            try {
                await pc.addIceCandidate(data.candidate);
            } catch (error) {
                console.error('Error handling ICE candidate:', error);
            }
        }
    }

    setupDataChannel(dataChannel, peerId) {
        this.dataChannels.set(peerId, dataChannel);
        
        dataChannel.onopen = () => {
            console.log('Data channel opened with', peerId);
            this.updatePeerConnectionStatus(peerId, 'connected');
        };

        dataChannel.onclose = () => {
            console.log('Data channel closed with', peerId);
            this.updatePeerConnectionStatus(peerId, 'disconnected');
        };

        dataChannel.onmessage = (event) => {
            this.handleDataChannelMessage(peerId, event.data);
        };
    }

    sendPeerMessage(peerId, message) {
        const dataChannel = this.dataChannels.get(peerId);
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'message', data: message }));
        } else {
            // Fallback to server relay
            this.socket.emit('message:send', {
                targetUserId: peerId,
                message: message
            });
        }
    }

    handleDataChannelMessage(peerId, data) {
        try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'message') {
                // Always save the message
                this.saveChatMessage(peerId, parsed.data);
                
                if (this.currentChat && this.currentChat.type === 'peer' && this.currentChat.id === peerId) {
                    // Display message if chat is currently open
                    this.displayMessage(parsed.data, false);
                } else {
                    // Handle background message
                    this.handleBackgroundMessage('peer', peerId, parsed.data);
                }
                
                // Always show notification
                const peer = this.peers.get(peerId);
                this.showNotificationAlert(`Message from ${peer ? peer.name : 'Peer'}`, parsed.data.text, () => {
                    this.startChat(peerId);
                });
            } else if (parsed.type === 'typing') {
                if (this.currentChat && this.currentChat.type === 'peer' && this.currentChat.id === peerId) {
                    this.showTyping(true, peerId);
                    clearTimeout(this.typingTimeout);
                    this.typingTimeout = setTimeout(() => this.showTyping(false), 1200);
                }
            } else if (parsed.type === 'edit') {
                this.applyMessageEdit(parsed.data.messageId, parsed.data.newText);
            } else if (parsed.type === 'delete') {
                this.applyMessageDelete(parsed.data.messageId);
            } else if (parsed.type === 'reaction') {
                this.applyReaction(parsed.data.messageId, parsed.data.emoji, parsed.data.userId, parsed.data.action);
            } else if (parsed.type === 'file-chunk') {
                this.handleFileChunk(peerId, parsed.data);
            }
        } catch (error) {
            console.error('Error parsing data channel message:', error);
        }
    }

    onEditMessage(messageId) {
        const el = document.querySelector(`[data-message-id="${messageId}"] .message-text`);
        if (!el) return;
        const current = el.textContent;
        const updated = prompt('Edit message:', current);
        if (updated === null) return;
        const trimmed = updated.trim();
        if (!trimmed) return;

        // Apply locally
        this.applyMessageEdit(messageId, trimmed);

        // Persist in IndexedDB not strictly necessary for demo; skip for simplicity

        if (this.currentChat.type === 'peer') {
            const dc = this.dataChannels.get(this.currentChat.id);
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'edit', data: { messageId, newText: trimmed } }));
            }
        } else if (this.currentChat.type === 'room') {
            this.socket.emit('room:message-edit', { roomId: this.currentChat.id, messageId, newText: trimmed });
        }
    }

    onDeleteMessage(messageId) {
        if (!confirm('Delete this message?')) return;
        this.applyMessageDelete(messageId);
        if (this.currentChat.type === 'peer') {
            const dc = this.dataChannels.get(this.currentChat.id);
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'delete', data: { messageId } }));
            }
        } else if (this.currentChat.type === 'room') {
            this.socket.emit('room:message-delete', { roomId: this.currentChat.id, messageId });
        }
    }

    applyMessageEdit(messageId, newText) {
        const el = document.querySelector(`[data-message-id="${messageId}"] .message-text`);
        if (el) {
            el.textContent = newText;
        }
    }

    applyMessageDelete(messageId) {
        const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
        if (bubble) {
            const row = bubble.parentElement;
            if (row && row.classList.contains('msg-row')) {
                row.remove();
            } else {
                bubble.remove();
            }
        }
    }

    updatePeerConnectionStatus(peerId, status) {
        // Update UI to show connection status
        const peerTiles = document.querySelectorAll(`[onclick*="${peerId}"]`);
        peerTiles.forEach(tile => {
            const statusEl = tile.querySelector('.connection-status');
            if (statusEl) {
                statusEl.className = `connection-status ${status}`;
            }
        });
    }

    // File Transfer Implementation
    async sendFile(file) {
        if (!this.currentChat || this.currentChat.type !== 'peer') {
            this.showNotification('File sharing only available in peer chats', 'error');
            return;
        }

        const fileId = this.generateId();
        const chunkSize = 512 * 1024; // 512KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        const fileData = {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            totalChunks: totalChunks
        };

        this.fileTransfers.set(fileId, {
            ...fileData,
            chunks: new Map(),
            progress: 0,
            direction: 'sending'
        });

        this.showFileProgress(fileData, 0);

        const dataChannel = this.dataChannels.get(this.currentChat.id);
        const useWebRTC = dataChannel && dataChannel.readyState === 'open';

        if (useWebRTC) {
            // Send via WebRTC
            dataChannel.send(JSON.stringify({
                type: 'file-start',
                data: fileData
            }));

            // Send chunks
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const arrayBuffer = await chunk.arrayBuffer();
                const base64 = this.arrayBufferToBase64(arrayBuffer);
                
                dataChannel.send(JSON.stringify({
                    type: 'file-chunk',
                    data: { fileId, chunkIndex: i, chunk: base64 }
                }));

                const progress = ((i + 1) / totalChunks) * 100;
                this.updateFileProgress(fileId, progress);
                
                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            dataChannel.send(JSON.stringify({
                type: 'file-end',
                data: { fileId }
            }));
        } else {
            // Fallback to server relay
            this.socket.emit('file:start', {
                targetUserId: this.currentChat.id,
                fileId: fileId,
                fileName: file.name,
                fileSize: file.size,
                totalChunks: totalChunks
            });

            // Send chunks via socket
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const arrayBuffer = await chunk.arrayBuffer();
                const base64 = this.arrayBufferToBase64(arrayBuffer);
                
                this.socket.emit('file:chunk', {
                    targetUserId: this.currentChat.id,
                    fileId: fileId,
                    chunkIndex: i,
                    chunk: base64
                });

                const progress = ((i + 1) / totalChunks) * 100;
                this.updateFileProgress(fileId, progress);
                
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            this.socket.emit('file:end', {
                targetUserId: this.currentChat.id,
                fileId: fileId
            });
        }
    }

    handleFileTransferStart(data) {
        this.fileTransfers.set(data.fileId, {
            id: data.fileId,
            name: data.fileName,
            size: data.fileSize,
            totalChunks: data.totalChunks,
            chunks: new Map(),
            progress: 0,
            direction: 'receiving'
        });

        // Normalize shape for UI helpers
        this.showFileProgress({ id: data.fileId, name: data.fileName }, 0);
        this.displayFileMessage({ name: data.fileName, size: data.fileSize }, false);
    }

    handleFileTransferChunk(data) {
        const transfer = this.fileTransfers.get(data.fileId);
        if (transfer) {
            transfer.chunks.set(data.chunkIndex, data.chunk);
            const progress = (transfer.chunks.size / transfer.totalChunks) * 100;
            transfer.progress = progress;
            this.updateFileProgress(data.fileId, progress);
        }
    }

    handleFileTransferEnd(data) {
        const transfer = this.fileTransfers.get(data.fileId);
        if (transfer && transfer.chunks.size === transfer.totalChunks) {
            this.assembleFile(transfer);
        }
    }

    async assembleFile(transfer) {
        const chunks = [];
        for (let i = 0; i < transfer.totalChunks; i++) {
            const base64Chunk = transfer.chunks.get(i);
            if (base64Chunk) {
                chunks.push(this.base64ToArrayBuffer(base64Chunk));
            }
        }

        const blob = new Blob(chunks);
        const url = URL.createObjectURL(blob);
        
        // Store in IndexedDB
        await this.storeFile(transfer.id, {
            name: transfer.name,
            size: transfer.size,
            blob: blob,
            url: url
        });

        this.hideFileProgress();
        this.showNotification(`File received: ${transfer.name}`, 'success');
        
        // Auto-download
        const a = document.createElement('a');
        a.href = url;
        a.download = transfer.name;
        a.click();
    }

    showFileProgress(fileData, progress) {
        document.getElementById('fileTransferProgress').classList.remove('hidden');
        const displayName = fileData.name || fileData.fileName || '';
        document.getElementById('progressFileName').textContent = displayName;
        const id = fileData.id || fileData.fileId;
        if (id) this.updateFileProgress(id, progress);
    }

    updateFileProgress(fileId, progress) {
        document.getElementById('progressPercent').textContent = `${Math.round(progress)}%`;
        document.getElementById('progressFill').style.width = `${progress}%`;
    }

    hideFileProgress() {
        document.getElementById('fileTransferProgress').classList.add('hidden');
    }

    displayFileMessage(fileData, isSent) {
        const container = document.getElementById('chatMessages');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const name = fileData.name || fileData.fileName || 'file';
        const size = typeof fileData.size === 'number' ? fileData.size : (fileData.fileSize || 0);
        messageEl.innerHTML = `
            <div class="file-message">
                <div class="file-info">
                    <span class="file-icon">📎</span>
                    <div class="file-details">
                        <div class="file-name">${this.escapeHtml(name)}</div>
                        <div class="file-size">${this.formatFileSize(size)}</div>
                    </div>
                </div>
            </div>
            <div class="message-time">${new Date().toLocaleTimeString()}</div>
        `;
        
        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
    }

    // IndexedDB Implementation
    async initializeIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('P2PWebChat', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Chat messages store
                if (!db.objectStoreNames.contains('messages')) {
                    const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
                    messagesStore.createIndex('chatId', 'chatId', { unique: false });
                    messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Files store
                if (!db.objectStoreNames.contains('files')) {
                    const filesStore = db.createObjectStore('files', { keyPath: 'id' });
                }
            };
        });
    }

    async saveChatMessage(chatId, message) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['messages'], 'readwrite');
        const store = transaction.objectStore('messages');
        
        await store.add({
            id: this.generateId(),
            chatId: chatId,
            message: message,
            timestamp: new Date()
        });
    }

    async loadChatHistory(chatId) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['messages'], 'readonly');
        const store = transaction.objectStore('messages');
        const index = store.index('chatId');
        
        const request = index.getAll(chatId);
        request.onsuccess = () => {
            const messages = request.result;
            const container = document.getElementById('chatMessages');
            container.innerHTML = '';
            
            messages.forEach(record => {
                const isSent = record.message.sender === this.currentUser.userId;
                this.displayMessage(record.message, isSent);
            });
        };
    }

    async storeFile(fileId, fileData) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        
        await store.add({
            id: fileId,
            ...fileData,
            timestamp: new Date()
        });
    }

    // Room messaging
    sendRoomMessage(roomId, message) {
        // Send room message via Socket.IO
        this.socket.emit('room:message', {
            roomId: roomId,
            message: message
        });
    }

    // Utility Functions
    generateId() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    emitTyping() {
        if (!this.currentChat) return;
        const now = Date.now();
        if (this._lastTypingEmit && now - this._lastTypingEmit < 500) return;
        this._lastTypingEmit = now;

        if (this.currentChat.type === 'peer') {
            const dc = this.dataChannels.get(this.currentChat.id);
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'typing', data: { at: now } }));
            }
        } else if (this.currentChat.type === 'room') {
            this.socket.emit('room:typing', { roomId: this.currentChat.id, isTyping: true });
        }
    }

    showTyping(isTyping, fromId = null) {
        const el = document.getElementById('typingIndicator');
        if (!el) return;
        if (isTyping) {
            if (this.currentChat && this.currentChat.type === 'room' && fromId) {
                const user = this.peers.get(fromId);
                el.textContent = `${user ? user.name : 'Someone'} is typing…`;
            } else {
                el.textContent = 'Typing…';
            }
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    leaveRoom(roomId) {
        this.socket.emit('room:leave', { roomId });
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    async ensureNotificationPermission() {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') return false;
        const perm = await Notification.requestPermission();
        return perm === 'granted';
    }

    async maybeNotify(title, body) {
        try {
            if (document.hasFocus()) return;
            const ok = await this.ensureNotificationPermission();
            if (!ok) return;
            new Notification(title, { body });
        } catch {}
    }
}

// Initialize the application
const app = new P2PWebChat();
