/* ═══════════════════════════════════════════════════════════════════════════
   Voxtral Voicebot — app.js
   Stack: Local LLM (OpenAI-compatible) · Voxtral-4B TTS · Whisper STT
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const API             = '';
const HEALTH_INTERVAL = 6000;   // ms between health polls
const MAX_CTX_TOKENS  = 8192;


// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  messages:      [],
  chats:         [],
  currentChatId: null,

  ttsEnabled:    true,
  activeAudioCtx: null,   // current Web Audio context — closed on chat switch

  isRecording:   false,
  isProcessing:  false,
  mediaRecorder: null,
  audioChunks:   [],
  customSystemPrompt: '',
  ttsTestMode:   true,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  messages:         $('messages'),
  input:            $('message-input'),
  sendBtn:          $('send-btn'),
  recordBtn:        $('record-btn'),
  ttsToggle:        $('tts-toggle'),
  ttsTestToggle:    $('tts-test-toggle'),
  voiceSelect:      $('voice-select'),
  typingInd:        $('typing-indicator'),
  recordOvl:        $('recording-overlay'),
  chatList:         $('chat-list'),
  newChatBtn:       $('new-chat-btn'),
  promptEditor:     $('system-prompt-editor'),
  savePromptBtn:    $('save-prompt-btn'),
  resetPromptBtn:   $('reset-prompt-btn'),
  sChips: {
    llm:        $('s-llm'),
    voxtral:    $('s-voxtral'),
    whisper:    $('s-whisper'),
  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────
const formatTime = (d = new Date()) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

function setProcessing(val) {
  state.isProcessing = val;
  el.sendBtn.disabled = val;
  el.typingInd.classList.toggle('hidden', !val);
  if (val) scrollToBottom();
}

// ── STT Backend switching ─────────────────────────────────────────────────────

function stopActiveAudio() {
  if (state.activeAudioCtx) {
    try { state.activeAudioCtx.close(); } catch (e) {}
    state.activeAudioCtx = null;
  }
}

// ── Storage & Chat History ────────────────────────────────────────────────────
async function loadStorage() {
  // Chat history from Backend
  try {
    const res = await fetch(`${API}/chats`);
    if (res.ok) state.chats = await res.json();
    else state.chats = [];
  } catch { state.chats = []; }

  // TTS backend preference
  const savedTts = localStorage.getItem('ttsEnabled');
  if (savedTts !== null) {
    state.ttsEnabled = savedTts === 'true';
    el.ttsToggle.classList.toggle('active', state.ttsEnabled);
  }

  // System prompt
  const savedPrompt = localStorage.getItem('systemPrompt') || '';
  state.customSystemPrompt = savedPrompt;
  el.promptEditor.value = savedPrompt;

  // Voice preference
  const savedVoice = localStorage.getItem('voice');
  if (savedVoice) el.voiceSelect.value = savedVoice;

  // Load chats
  if (state.chats.length > 0) {
    selectChat(state.chats[0].id);
  } else {
    newChat();
  }
}

function updateContextMeter() {
  const chars = state.messages.reduce((acc, m) => acc + (m.content || '').length, 0);
  const approxTokens = Math.floor(chars / 3.5);
  const el = $('context-text');
  if (el) el.textContent = `${Math.min(approxTokens, MAX_CTX_TOKENS)} / ${MAX_CTX_TOKENS}`;
}

async function saveStorage() {
  const current = state.chats.find(c => c.id === state.currentChatId);
  if (current) {
    current.messages = [...state.messages];
    if (current.title === 'New Chat' && state.messages.length > 0) {
      const first = state.messages.find(m => m.role === 'user');
      if (first) current.title = first.content.slice(0, 40) + (first.content.length > 40 ? '…' : '');
    }
  }

  renderChatList();
  updateContextMeter();

  if (current) {
    try {
      const payload = {
        id: current.id,
        title: current.title,
        messages: current.messages,
        date: new Date().toISOString()
      };
      await fetch(`${API}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error('Failed to sync chat to backend', e);
    }
  }
}

async function deleteChat(id, e) {
  e.stopPropagation();
  try {
    await fetch(`${API}/chats/${id}`, { method: 'DELETE' });
  } catch(e) {}
  
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.currentChatId === id) {
    if (state.chats.length > 0) selectChat(state.chats[0].id);
    else newChat();
  } else {
    renderChatList();
  }
}

function renderChatList() {
  el.chatList.innerHTML = '';
  [...state.chats].forEach((c, idx, arr) => {
    // We reverse iteration visually to show newest first, assuming state.chats is appended at end or beginning
    // let's just make sure newer is on top. We'll do simple DOM insert
    const item = arr[arr.length - 1 - idx];
    const li = document.createElement('li');
    li.className = 'chat-item' + (item.id === state.currentChatId ? ' active' : '');
    li.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${item.title}</span>
      <button class="delete-chat-btn" title="Delete chat">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `;
    li.onclick = () => selectChat(item.id);
    li.querySelector('.delete-chat-btn').onclick = (e) => deleteChat(item.id, e);
    el.chatList.appendChild(li);
  });
}

function newChat() {
  const id = Date.now().toString();
  state.chats.push({ id, title: 'New Chat', messages: [] });
  selectChat(id);
}

function selectChat(id) {
  stopActiveAudio();
  state.currentChatId = id;
  const chat = state.chats.find(c => c.id === id);
  state.messages = chat ? [...chat.messages] : [];
  el.messages.innerHTML = '';

  if (state.messages.length === 0) {
    renderWelcomeScreen();
  } else {
    state.messages.forEach(msg => _renderBubble(msg.role, msg.content, null));
  }

  renderChatList();
  saveStorage();
  scrollToBottom();
}

// ── Welcome Screen ────────────────────────────────────────────────────────────
function renderWelcomeScreen() {
  const div = document.createElement('div');
  div.className = 'welcome-screen';
  div.innerHTML = `
    <div class="welcome-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#wgrad)"/>
        <path d="M8 12 Q10 8 12 12 Q14 16 16 12" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <defs>
          <linearGradient id="wgrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#8b5cf6"/>
            <stop offset="100%" stop-color="#06b6d4"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <div>
      <div class="welcome-title">Voxtral Voice Engine</div>
    </div>
    <p class="welcome-sub">Instant local voice synthesis — type anything to hear it spoken in high-fidelity.</p>
    <div class="welcome-hints">
      <div class="welcome-hint-item">
        <kbd>Enter</kbd> Speak typed text immediately
      </div>
      <div class="welcome-hint-item">
        <kbd>Shift+Enter</kbd> New line for longer text
      </div>
      <div class="welcome-hint-item">
        <kbd>Mode</kbd> Click the AI icon (top right) to switch to <strong>Full Voice Chat</strong>
      </div>
    </div>
  `;
  el.messages.appendChild(div);
}

// ── Health polling ─────────────────────────────────────────────────────────────
async function pollHealth() {
  try {
    const res = await fetch(`${API}/health`);
    const data = await res.json();

    // Map health keys to chips
    const map = {
      llm:          el.sChips.llm,
      voxtral:      el.sChips.voxtral,
      whisper:      el.sChips.whisper,
    };
    for (const [key, chip] of Object.entries(map)) {
      if (!chip) continue;
      const status = data[key] || 'offline';
      chip.className = `status-chip ${status}`;
    }

    if (data.llm_model) {
      const llmLabel = el.sChips.llm.querySelector('.label');
      if (llmLabel) {
        let name = data.llm_model.split('/').pop();
        if (name.length > 22) name = name.substring(0, 20) + '…';
        llmLabel.textContent = name;
      }
    }
  } catch {
    Object.values(el.sChips).forEach(c => c && (c.className = 'status-chip offline'));
  }
}

// ── Message rendering ──────────────────────────────────────────────────────────
function appendMessage(role, content, audioBlob = null) {
  // Remove welcome screen if present
  const welcome = el.messages.querySelector('.welcome-screen');
  if (welcome) welcome.remove();

  state.messages.push({ role, content });
  _renderBubble(role, content, audioBlob);
  saveStorage();
}

/** Create empty live bubble for streaming. */
function createLiveBubble() {
  // Remove welcome screen if present
  const welcome = el.messages.querySelector('.welcome-screen');
  if (welcome) welcome.remove();

  const row = document.createElement('div');
  row.className = 'message-row ai';

  const avatarEl = document.createElement('div');
  avatarEl.className = 'avatar ai-avatar';
  avatarEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M8 12 Q10 8 12 12 Q14 16 16 12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble ai-bubble';

  const reasoningEl = document.createElement('div');
  reasoningEl.className = 'bubble-reasoning hidden';

  const textEl = document.createElement('div');
  textEl.className = 'bubble-text';
  textEl.textContent = '';

  bubble.append(reasoningEl, textEl);
  row.append(avatarEl, bubble);
  el.messages.appendChild(row);
  scrollToBottom();
  return { textEl, reasoningEl, bubble, row };
}

/** Finalise a live bubble — add meta, actions, audio. */
function finaliseBubble(bubble, textEl, fullText, audioBlob = null, latency = null) {
  state.messages.push({ role: 'assistant', content: fullText });

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  const timeEl = document.createElement('span');
  timeEl.className = 'bubble-time';
  
  let timeStr = formatTime();
  if (latency && latency.llm_ttfb_ms) {
    timeStr += ` · TTFB: ${latency.llm_ttfb_ms}ms`;
  }
  timeEl.textContent = timeStr;

  const myIndex = state.messages.length - 1;
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = `
    <button class="action-btn copy-btn" title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M4 16V4a2 2 0 0 1 2-2h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    <button class="action-btn edit-btn" title="Edit" onclick="editMessage(${myIndex})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <button class="action-btn regen-btn" title="Regenerate" onclick="regenerateMessage(${myIndex})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <button class="action-btn del-btn" title="Delete" onclick="deleteMessage(${myIndex})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  `;

  actions.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(fullText).then(() => {
      actions.querySelector('.copy-btn').classList.add('copied');
      setTimeout(() => actions.querySelector('.copy-btn').classList.remove('copied'), 1500);
    });
  });

  meta.append(timeEl, actions);

  if (audioBlob) {
    const audioWrap = document.createElement('div');
    audioWrap.className = 'bubble-audio';
    const audio = document.createElement('audio');
    audio.src = URL.createObjectURL(audioBlob);
    audio.controls = true; audio.autoplay = true;
    audioWrap.appendChild(audio);
    bubble.appendChild(audioWrap);
  }

  bubble.appendChild(meta);
  scrollToBottom();
  saveStorage();
}

/** Render a static (non-streaming) message bubble. */
function _renderBubble(role, content, audioBlob = null) {
  const isAI = role === 'assistant';
  const row = document.createElement('div');
  row.className = `message-row ${isAI ? 'ai' : 'user'}`;

  const avatarEl = document.createElement('div');
  avatarEl.className = `avatar ${isAI ? 'ai-avatar' : 'user-avatar'}`;
  avatarEl.innerHTML = isAI
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M8 12 Q10 8 12 12 Q14 16 16 12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`
    : 'U';

  const bubble = document.createElement('div');
  bubble.className = `bubble ${isAI ? 'ai-bubble' : 'user-bubble'}`;

  const textEl = document.createElement('div');
  textEl.className = 'bubble-text';
  textEl.textContent = content;

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  const timeEl = document.createElement('span');
  timeEl.className = 'bubble-time';
  timeEl.textContent = formatTime();

  const myIndex = state.messages.findIndex(m => m.content === content && m.role === role);
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  let btnsHTML = `<button class="action-btn copy-btn" title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M4 16V4a2 2 0 0 1 2-2h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`;
  btnsHTML += `<button class="action-btn edit-btn" title="Edit" onclick="editMessage(${myIndex})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  if (isAI) {
    btnsHTML += `<button class="action-btn regen-btn" title="Regenerate" onclick="regenerateMessage(${myIndex})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  }
  btnsHTML += `<button class="action-btn del-btn" title="Delete" onclick="deleteMessage(${myIndex})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;

  actions.innerHTML = btnsHTML;
  actions.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(content).then(() => {
      actions.querySelector('.copy-btn').classList.add('copied');
      setTimeout(() => actions.querySelector('.copy-btn').classList.remove('copied'), 1500);
    });
  });

  meta.append(timeEl, actions);
  bubble.append(textEl);

  if (isAI && audioBlob) {
    const audioWrap = document.createElement('div');
    audioWrap.className = 'bubble-audio';
    const audio = document.createElement('audio');
    audio.src = URL.createObjectURL(audioBlob);
    audio.controls = true; audio.autoplay = true;
    audioWrap.appendChild(audio);
    bubble.appendChild(audioWrap);
  }

  bubble.appendChild(meta);
  row.append(avatarEl, bubble);
  el.messages.appendChild(row);
  scrollToBottom();
}

// fetchAndInjectAudio removed — superseded by Web Audio API engine in fetchAssistantReply

// ── Message management ────────────────────────────────────────────────────────
window.deleteMessage = function(idx) {
  if (state.isProcessing) return;
  if (!confirm('Delete this message?')) return;
  state.messages.splice(idx, 1);
  saveStorage();
  selectChat(state.currentChatId);
};

window.editMessage = function(idx) {
  if (state.isProcessing) return;
  const msg = state.messages[idx];
  const newText = prompt('Edit message:', msg.content);
  if (newText !== null && newText.trim() !== '' && newText !== msg.content) {
    state.messages[idx].content = newText;
    saveStorage();
    selectChat(state.currentChatId);
  }
};

window.regenerateMessage = function(idx) {
  if (state.isProcessing) return;
  state.messages.splice(idx);
  saveStorage();
  selectChat(state.currentChatId);
  setProcessing(true);
  fetchAssistantReply();
};

// ── Chat flow ─────────────────────────────────────────────────────────────────
async function sendMessage(text) {
  if (!text.trim() || state.isProcessing) return;

  // TTS Test Mode: bypass LLM, speak directly
  if (state.ttsTestMode) {
    return sendTtsTest(text);
  }

  el.input.value = '';
  el.input.style.height = '';
  appendMessage('user', text);
  setProcessing(true);
  await fetchAssistantReply();
}

async function fetchAssistantReply() {
  stopActiveAudio();  // cancel any audio still playing from a previous response
  const { textEl, reasoningEl, bubble } = createLiveBubble();
  let fullReply = '', fullReasoning = '';

  // ── Web Audio API Engine — gapless playback ───────────────────────────────
  // Each WAV chunk is decoded into an AudioBuffer and scheduled to start
  // exactly where the previous one ended. No src-swap, no browser reset,
  // no audible gap between sentences.
  let audioCtx = null;
  let nextStartTime = 0;        // when to start the next buffer (AudioContext time)
  let audioWrap = null;         // bubble element for the waveform indicator
  let isAudioActive = false;    // true while at least one chunk is scheduled

  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      state.activeAudioCtx = audioCtx;  // allow external cancellation
      nextStartTime = audioCtx.currentTime;

      // Waveform indicator inside the bubble
      audioWrap = document.createElement('div');
      audioWrap.className = 'bubble-audio tts-playing';
      audioWrap.innerHTML = `
        <div class="tts-waveform">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
        <span class="tts-playing-label">Playing…</span>`;
      bubble.appendChild(audioWrap);
      scrollToBottom();
    }
  }

  async function handleAudioChunk(arrayBuffer) {
    if (!state.ttsEnabled) return;
    try {
      ensureAudioContext();
      // Resume if browser suspended the context (autoplay policy)
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      const source  = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(audioCtx.destination);

      // Schedule: start exactly after previous chunk ends
      const startAt = Math.max(nextStartTime, audioCtx.currentTime);
      source.start(startAt);
      nextStartTime = startAt + decoded.duration;
      isAudioActive = true;

      source.onended = () => {
        // When the last chunk finishes, update the indicator
        if (audioCtx && audioCtx.currentTime >= nextStartTime - 0.05) {
          isAudioActive = false;
          if (audioWrap) {
            audioWrap.classList.remove('tts-playing');
            audioWrap.innerHTML = `<span class="tts-done-label">🔊 Audio played</span>`;
          }
        }
      };
    } catch (e) {
      console.warn('Web Audio decode error:', e);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    if (API) {
      wsUrl = API.replace('http:', 'ws:').replace('https:', 'wss:') + '/ws/chat';
    }
    const ws = new WebSocket(wsUrl);
    let latencyData = null;

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({
          messages:      state.messages,
          system_prompt: state.customSystemPrompt || undefined,
          voice:         el.voiceSelect.value || undefined,
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'text') {
            if (msg.is_thinking) {
              fullReasoning += msg.content;
              reasoningEl.textContent = fullReasoning;
              reasoningEl.classList.remove('hidden');
            } else {
              fullReply += msg.content;
              textEl.textContent = fullReply;
            }
            scrollToBottom();
          } else if (msg.type === 'audio' && state.ttsEnabled) {
            // Decode Base64 → ArrayBuffer (avoids Blob round-trip)
            const raw     = atob(msg.pcm_base64);
            const buf     = new ArrayBuffer(raw.length);
            const view    = new Uint8Array(buf);
            for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
            // Fire-and-forget: decode + schedule (async, non-blocking)
            handleAudioChunk(buf);
          } else if (msg.type === 'latency') {
            latencyData = msg;
          } else if (msg.type === 'error') {
            reject(new Error(msg.message));
          } else if (msg.type === 'done') {
            ws.close();
            resolve();
          }
        } catch (e) {
          console.warn('WS parse error:', e);
        }
      };
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      ws.onclose = () => resolve();
    });

    if (!fullReply && fullReasoning) {
      fullReply = '(No final response.)';
      textEl.textContent = fullReply;
    } else if (!fullReply && !fullReasoning) {
      throw new Error('Empty response from LLM');
    }

    finaliseBubble(bubble, textEl, fullReply, null, latencyData);

  } catch (err) {
    textEl.textContent = `⚠️ ${err.message}`;
    state.messages.push({ role: 'assistant', content: textEl.textContent });
    saveStorage();
  } finally {
    setProcessing(false);
  }
}

// ── Recording — Whisper REST ──────────────────────────────────────────────────
async function startWhisperRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.recordingStartTime = Date.now();
    state.mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.audioChunks.push(e.data); };
    state.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const duration = Date.now() - state.recordingStartTime;
      if (duration < 500 || state.audioChunks.length === 0) {
        console.warn("Recording was too short or empty. Ignoring.");
        return;
      }
      const blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });
      await transcribeWhisper(blob, state.mediaRecorder.mimeType);
    };
    state.mediaRecorder.start();
    state.isRecording = true;
    el.recordBtn.classList.add('recording');
    el.recordOvl.classList.remove('hidden');
  } catch (err) { alert('Mic access denied: ' + err.message); }
}

function stopWhisperRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;
  state.mediaRecorder.stop();
  state.isRecording = false;
  el.recordBtn.classList.remove('recording');
  el.recordOvl.classList.add('hidden');
}

async function transcribeWhisper(blob, mimeType) {
  // Show a lightweight "transcribing..." state — NOT the full processing spinner
  el.recordBtn.disabled = true;
  const origTitle = el.recordBtn.title;
  el.recordBtn.title = 'Transcribing…';

  try {
    const form = new FormData();
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'wav';
    form.append('audio', blob, `recording.${ext}`);
    const res = await fetch(`${API}/stt`, { method: 'POST', body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({ detail: res.statusText }))).detail);
    const { text } = await res.json();

    if (text && text.trim()) {
      // ✅ Put text in input for review — do NOT auto-send
      el.input.value = text;
      autoResizeTextarea();
      el.input.focus();

      // Visual hint: highlight the input briefly so user knows it's ready to review
      el.input.classList.add('stt-ready');
      setTimeout(() => el.input.classList.remove('stt-ready'), 1800);
    }
    // If empty, just silently do nothing
  } catch (err) {
    console.error('Whisper STT:', err);
    appendMessage('assistant', `⚠️ Transcription failed: ${err.message}`);
  } finally {
    el.recordBtn.disabled = false;
    el.recordBtn.title = origTitle;
  }
}

// ── Unified recording toggle ───────────────────────────────────────────────────
function toggleRecording() {
  if (state.isRecording) stopWhisperRecording();
  else startWhisperRecording();
}

// ── TTS Test Mode ─────────────────────────────────────────────────────────────
function toggleTtsTestMode() {
  state.ttsTestMode = !state.ttsTestMode;
  el.ttsTestToggle.classList.toggle('active', !state.ttsTestMode);

  // Insert / remove the banner below the header
  const existing = $('tts-test-banner');
  if (!state.ttsTestMode) {
    if (!existing) {
      const banner = document.createElement('div');
      banner.id = 'tts-test-banner';
      banner.style.background = 'linear-gradient(90deg, rgba(139,92,246,0.12), rgba(6,182,212,0.1))';
      banner.style.color = 'var(--accent)';
      banner.style.borderBottom = '1px solid rgba(139,92,246,0.2)';
      banner.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2z" fill="currentColor" opacity="0.1"/>
          <path d="M8 12 Q10 8 12 12 Q14 16 16 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
        </svg>
        <strong>AI Chat Mode (Experimental)</strong> &mdash; Connect an API to speak with an LLM via voice
      `;
      const chatArea = document.getElementById('chat-area');
      chatArea.insertBefore(banner, chatArea.firstChild);
    }
    el.input.placeholder = 'Type a message or press the mic to speak…';
    el.sendBtn.title = 'Send to AI (Enter)';
    el.sendBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else {
    if (existing) existing.remove();
    el.input.placeholder = 'Type anything… it will be spoken aloud instantly';
    el.sendBtn.title = 'Speak this text';
    el.sendBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
}

async function sendTtsTest(text) {
  if (!text.trim() || state.isProcessing) return;
  el.input.value = '';
  el.input.style.height = '';

  // Show the text as a user bubble for reference
  const welcome = el.messages.querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  _renderBubble('user', text);

  // Immediately call TTS
  const voice = el.voiceSelect.value;
  setProcessing(true);
  try {
    const res = await fetch(`${API}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);

    // Render a small audio player bubble instead of AI text
    const row = document.createElement('div');
    row.className = 'message-row ai';
    row.style.animation = 'msg-in 0.3s cubic-bezier(0.16,1,0.3,1) both';
    row.innerHTML = `
      <div class="avatar ai-avatar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </div>
      <div class="bubble ai-bubble">
        <div class="bubble-text" style="padding:10px 14px">
          <div class="bubble-audio">
            <audio src="${url}" controls autoplay style="width:100%;height:30px"></audio>
          </div>
          <div style="font-size:10px;color:var(--accent-3);margin-top:6px">Voxtral TTS · ${voice}</div>
        </div>
      </div>
    `;
    el.messages.appendChild(row);
    scrollToBottom();
  } catch (err) {
    appendMessage('assistant', `⚠️ TTS error: ${err.message}`);
  } finally {
    setProcessing(false);
  }
}

// ── System Prompt Editor ──────────────────────────────────────────────────────
function saveSystemPrompt() {
  const val = el.promptEditor.value.trim();
  state.customSystemPrompt = val;
  localStorage.setItem('systemPrompt', val);
  el.savePromptBtn.classList.add('saved');
  el.savePromptBtn.textContent = '✓ Saved';
  setTimeout(() => {
    el.savePromptBtn.classList.remove('saved');
    el.savePromptBtn.textContent = 'Save Prompt';
  }, 1500);
}

function resetSystemPrompt() {
  el.promptEditor.value = '';
  state.customSystemPrompt = '';
  localStorage.removeItem('systemPrompt');
  el.savePromptBtn.textContent = 'Save Prompt';
}

function toggleTTS() {
  state.ttsEnabled = !state.ttsEnabled;
  el.ttsToggle.classList.toggle('active', state.ttsEnabled);
  localStorage.setItem('ttsEnabled', state.ttsEnabled);
}



// ── Textarea auto-resize ───────────────────────────────────────────────────────
function autoResizeTextarea() {
  el.input.style.height = '';
  el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
}

// ── Init ───────────────────────────────────────────────────────────────────────
function init() {
  loadStorage();
  pollHealth();
  setInterval(pollHealth, HEALTH_INTERVAL);

  // New chat
  el.newChatBtn.addEventListener('click', newChat);

  // Send
  el.sendBtn.addEventListener('click', () => sendMessage(el.input.value));

  // Enter to send
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(el.input.value); }
  });

  // Auto-resize
  el.input.addEventListener('input', autoResizeTextarea);

  // Mic
  el.recordBtn.addEventListener('click', toggleRecording);

  // Spacebar shortcut — exclude chat input AND system prompt textarea
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' &&
        document.activeElement !== el.input &&
        document.activeElement !== el.promptEditor) {
      e.preventDefault(); toggleRecording();
    }
  });

  // TTS toggle
  el.ttsToggle.addEventListener('click', toggleTTS);

  // TTS Test Mode toggle
  el.ttsTestToggle.addEventListener('click', toggleTtsTestMode);

  // System prompt save/reset
  el.savePromptBtn.addEventListener('click', saveSystemPrompt);
  el.resetPromptBtn.addEventListener('click', resetSystemPrompt);



  // Voice selector
  el.voiceSelect.addEventListener('change', () => {
    localStorage.setItem('voice', el.voiceSelect.value);
  });
}

document.addEventListener('DOMContentLoaded', init);
