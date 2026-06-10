// --- State Setup & Local Storage ---
// Safe storage wrapper for WebView file:// compatibility to prevent SecurityError
const localStorageMock = (() => {
  let isMem = false;
  try {
    window.localStorage.setItem('__test__', '1');
    window.localStorage.removeItem('__test__');
  } catch (e) {
    isMem = true;
    console.warn("localStorage is not accessible in this context, using in-memory fallback.");
  }
  const mem = {};
  return {
    getItem: (k) => {
      if (isMem) return mem[k] || null;
      try { return window.localStorage.getItem(k); } catch (e) { return mem[k] || null; }
    },
    setItem: (k, v) => {
      if (isMem) { mem[k] = String(v); return; }
      try { window.localStorage.setItem(k, v); } catch (e) { mem[k] = String(v); }
    },
    removeItem: (k) => {
      if (isMem) { delete mem[k]; return; }
      try { window.localStorage.removeItem(k); } catch (e) { delete mem[k]; }
    }
  };
})();
const safeStorage = localStorageMock;

let conversations = JSON.parse(safeStorage.getItem('gemini_conversations') || '[]');
let currentChatId = safeStorage.getItem('gemini_current_chat_id');
let systemInstructions = "You are a helpful, advanced, responsive AI agent and professional companion. You write elegant code, detailed step-by-step answers, and reply clearly. Format replies using clean Markdown, bold metrics, and code blocks with clear language labels when needed.";

// Configuration/API States
let isGenerating = false;

// Initialize app on loading
window.addEventListener('DOMContentLoaded', () => {
  // Setup theme
  initTheme();
  
  // Verify API Key
  checkApiKeyStatus();

  // Load discussions list
  renderHistory();

  // Load current chat or start first
  if (currentChatId && conversations.find(c => c.id === currentChatId)) {
    loadChat(currentChatId);
  } else if (conversations.length > 0) {
    loadChat(conversations[0].id);
  } else {
    startNewChat();
  }

  // Set initial scroll trigger
  scrollToBottom();
  
  // Auto-resize chat input
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    
    // Toggle send button active/inactive state
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = this.value.trim().length === 0;
  });
});

// Configure Marked Markdown Renderer
const renderer = new marked.Renderer();
// Override code block rendering
renderer.code = function(code, language) {
  const originalCode = code;
  const validLang = language || 'javascript';
  let highlighted = originalCode;
  
  try {
    if (hljs.getLanguage(validLang)) {
      highlighted = hljs.highlight(originalCode, { language: validLang }).value;
    } else {
      highlighted = hljs.highlightAuto(originalCode).value;
    }
  } catch (err) {
    console.error("Syntax highlighting error: ", err);
  }

  // Return custom container styled like ChatGPT with clear language header and Copy button
  return `
    <div class="my-4 rounded-xl overflow-hidden border border-chatgray-200 dark:border-chatgray-800">
      <div class="bg-chatgray-100 dark:bg-chatgray-850 px-4 py-2 flex justify-between items-center text-xs text-chatgray-600 dark:text-chatgray-400 font-mono select-none border-b border-chatgray-200 dark:border-chatgray-800">
        <span class="capitalize">${validLang}</span>
        <button onclick="copyRawCode(this)" class="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-chatgray-200 dark:hover:bg-chatgray-750 hover:text-indigo-600 dark:hover:text-indigo-400 transition" data-code="${encodeURIComponent(originalCode)}">
          <i class="fa-regular fa-copy"></i>
          <span>Copy code</span>
        </button>
      </div>
      <pre class="bg-chatgray-50 dark:bg-chatgray-900 p-4 overflow-x-auto"><code class="hljs ${validLang}">${highlighted}</code></pre>
    </div>
  `;
};
marked.use({ renderer });

// --- API Key Discovery via Android Interface ---
function getApiKey() {
  if (window.AndroidInterface && typeof window.AndroidInterface.getGeminiApiKey === "function") {
    return window.AndroidInterface.getGeminiApiKey();
  }
  return "";
}

function checkApiKeyStatus() {
  const key = getApiKey();
  const banner = document.getElementById('missing-key-banner');
  
  if (!key || key === "" || key === "MY_GEMINI_API_KEY" || key.startsWith("MY_")) {
    banner.classList.remove('hidden');
    console.warn("Gemini API key is missing or unset. Please setup the key in AI Studio Secrets panel.");
    return false;
  } else {
    banner.classList.add('hidden');
    return true;
  }
}

// --- Theme Toggling Logic ---
function initTheme() {
  const savedTheme = safeStorage.getItem('gemini_theme') || 'dark';
  const html = document.documentElement;
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');

  if (savedTheme === 'dark') {
    html.classList.add('dark');
    if (themeIcon) themeIcon.className = "fa-solid fa-sun w-5";
    if (themeText) themeText.textContent = "Light Mode";
  } else {
    html.classList.remove('dark');
    if (themeIcon) themeIcon.className = "fa-solid fa-moon w-5";
    if (themeText) themeText.textContent = "Dark Mode";
  }
}

function toggleTheme() {
  const html = document.documentElement;
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');
  
  // Add animation class
  document.body.classList.add('theme-transition');
  
  if (html.classList.contains('dark')) {
    html.classList.remove('dark');
    safeStorage.setItem('gemini_theme', 'light');
    if (themeIcon) themeIcon.className = "fa-solid fa-moon w-5";
    if (themeText) themeText.textContent = "Dark Mode";
  } else {
    html.classList.add('dark');
    safeStorage.setItem('gemini_theme', 'dark');
    if (themeIcon) themeIcon.className = "fa-solid fa-sun w-5";
    if (themeText) themeText.textContent = "Light Mode";
  }
  
  setTimeout(() => {
    document.body.classList.remove('theme-transition');
  }, 300);
}

// --- Sidebar Navigation Toggles ---
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  
  if (sidebar.classList.contains('-translate-x-full')) {
    sidebar.classList.remove('-translate-x-full');
    overlay.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  }
}

// --- Sidebar Conversation Management ---
function renderHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '';

  if (conversations.length === 0) {
    container.innerHTML = `
      <div class="text-xs text-chatgray-450 dark:text-chatgray-500 text-center py-6 select-none font-medium">
        <span>No chat sessions yet.</span>
      </div>
    `;
    return;
  }

  conversations.forEach(chat => {
    const isActive = chat.id === currentChatId;
    const item = document.createElement('div');
    item.className = `group flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition duration-150 relative cursor-pointer ${
      isActive 
        ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-250 font-medium border-l-4 border-indigo-500' 
        : 'text-chatgray-700 dark:text-chatgray-300 hover:bg-chatgray-50 dark:hover:bg-chatgray-800'
    }`;
    
    item.innerHTML = `
      <div class="flex items-center gap-2.5 overflow-hidden flex-1 mr-2" onclick="loadChat('${chat.id}')">
        <i class="fa-regular fa-message text-xs opacity-65 group-hover:opacity-100 transition"></i>
        <span class="truncate block pr-2 text-xs" id="title-text-${chat.id}">${chat.title}</span>
      </div>
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition z-10">
        <button onclick="editChatTitle('${chat.id}', event)" class="p-1 rounded text-chatgray-500 dark:text-chatgray-400 hover:bg-chatgray-200 dark:hover:bg-chatgray-705" title="Rename Session">
          <i class="fa-solid fa-pen text-[10px]"></i>
        </button>
        <button onclick="deleteChat('${chat.id}', event)" class="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" title="Delete Session">
          <i class="fa-solid fa-trash text-[10px]"></i>
        </button>
      </div>
    `;
    container.appendChild(item);
  });
}

function startNewChat() {
  const newId = 'chat_' + Date.now();
  const newChat = {
    id: newId,
    title: 'New Chat Session',
    messages: [],
    createdAt: new Date().toISOString()
  };

  conversations.unshift(newChat);
  safeStorage.setItem('gemini_conversations', JSON.stringify(conversations));
  currentChatId = newId;
  safeStorage.setItem('gemini_current_chat_id', currentChatId);

  renderHistory();
  loadChat(newId);
  
  // Close sidebar on mobile
  if (window.innerWidth < 768) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar.classList.contains('-translate-x-full')) {
      toggleSidebar();
    }
  }
}

function loadChat(id) {
  currentChatId = id;
  safeStorage.setItem('gemini_current_chat_id', currentChatId);
  
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;

  document.getElementById('current-chat-title').textContent = chat.title;
  renderHistory();

  const emptyState = document.getElementById('empty-state');
  const msgListContainer = document.getElementById('messages-list');
  const msgList = document.getElementById('messages-list');
  
  msgList.innerHTML = '';

  if (chat.messages.length === 0) {
    emptyState.classList.remove('hidden');
    msgListContainer.classList.add('hidden');
  } else {
    emptyState.classList.add('hidden');
    msgListContainer.classList.remove('hidden');
    
    chat.messages.forEach(msg => {
      appendMessageHTML(msg.role, msg.text);
    });
  }
  
  scrollToBottom();
}

function editChatTitle(id, event) {
  event.stopPropagation();
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;

  const currentTitle = chat.title;
  const newTitle = prompt('Rename this session:', currentTitle);
  if (newTitle && newTitle.trim() !== '') {
    chat.title = newTitle.trim();
    safeStorage.setItem('gemini_conversations', JSON.stringify(conversations));
    renderHistory();
    if (currentChatId === id) {
      document.getElementById('current-chat-title').textContent = chat.title;
    }
  }
}

function deleteChat(id, event) {
  event.stopPropagation();
  if (confirm('Are you sure you want to delete this chat session?')) {
    conversations = conversations.filter(c => c.id !== id);
    safeStorage.setItem('gemini_conversations', JSON.stringify(conversations));
    
    if (currentChatId === id) {
      currentChatId = conversations.length > 0 ? conversations[0].id : null;
      safeStorage.setItem('gemini_current_chat_id', currentChatId);
    }
    
    renderHistory();
    if (currentChatId) {
      loadChat(currentChatId);
    } else {
      startNewChat();
    }
  }
}

function clearHistory() {
  if (confirm('Select OK to delete all stored conversation sessions.')) {
    conversations = [];
    currentChatId = null;
    safeStorage.removeItem('gemini_conversations');
    safeStorage.removeItem('gemini_current_chat_id');
    startNewChat();
  }
}

function clearCurrentChat() {
  const chat = conversations.find(c => c.id === currentChatId);
  if (chat && chat.messages.length > 0) {
    if (confirm('Clear all messages in the current conversation?')) {
      chat.messages = [];
      safeStorage.setItem('gemini_conversations', JSON.stringify(conversations));
      loadChat(currentChatId);
    }
  }
}

// --- Content and Suggestion Handlers ---
function applySuggestion(text) {
  const chatInput = document.getElementById('chat-input');
  chatInput.value = text;
  chatInput.dispatchEvent(new Event('input')); // trigger resize
  
  // Submit
  const event = { preventDefault: () => {} };
  handleChatSubmit(event);
}

// --- Smooth Scrolling ---
function scrollToBottom() {
  const container = document.getElementById('messages-container');
  container.scrollTo({
    top: container.scrollHeight,
    behavior: 'smooth'
  });
}

// --- Keyboard Event Interceptors ---
function handleTextareaKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const chatForm = document.getElementById('chat-form');
    // Dispatch submit
    chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
  }
}

// --- Append message bubbles to UI list ---
function appendMessageHTML(role, text) {
  const messagesList = document.getElementById('messages-list');
  const div = document.createElement('div');
  div.className = "flex flex-col space-y-2 fade-in group";
  
  const isAlt = role === 'model';
  
  let contentHtml = "";
  if (isAlt) {
    // Render dynamic markdown
    contentHtml = marked.parse(text);
  } else {
    // Plain text for user with HTML entity encoding
    contentHtml = `<p class="whitespace-pre-wrap leading-relaxed">${escapeHTML(text)}</p>`;
  }

  const avatarBg = isAlt 
    ? 'bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white' 
    : 'bg-chatgray-300 dark:bg-chatgray-700 text-chatgray-700 dark:text-chatgray-300';
  
  const icon = isAlt ? 'fa-solid fa-wand-magic-sparkles' : 'fa-regular fa-user';
  
  div.innerHTML = `
    <div class="flex items-start gap-3 ${isAlt ? '' : 'flex-row-reverse'}">
      <!-- Avatar Bubble -->
      <div class="w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-xs shadow-sm flex-shrink-0">
        <i class="${icon}"></i>
      </div>
      
      <!-- Content Bubble Wrapper -->
      <div class="max-w-[84%] rounded-2xl px-4 py-3 shadow-sm leading-relaxed ${
        isAlt 
          ? 'bg-white dark:bg-chatgray-901 border border-chatgray-200/80 dark:border-chatgray-800 text-chatgray-950 dark:text-chatgray-100 rounded-tl-sm' 
          : 'bg-indigo-600 text-white rounded-tr-sm'
      }">
        <div class="prose prose-sm max-w-none dark:prose-invert">
          ${contentHtml}
        </div>
        
        <!-- Utility Actions at Bottom of Bubble -->
        <div class="mt-2.5 flex items-center gap-3 text-xs opacity-0 group-hover:opacity-100 transition float-right border-t border-chatgray-100 dark:border-chatgray-850 pt-1.5 w-full justify-end select-none">
          <button onclick="copyBubbleText(this)" class="flex items-center gap-1 hover:text-indigo-400 py-0.5 px-1.5 rounded hover:bg-chatgray-100 dark:hover:bg-chatgray-800 transition ${isAlt ? 'text-chatgray-450 dark:text-chatgray-505' : 'text-indigo-200 hover:text-white'}" data-raw="${encodeURIComponent(text)}">
            <i class="fa-regular fa-copy"></i>
            <span>Copy text</span>
          </button>
        </div>
      </div>
    </div>
  `;

  messagesList.appendChild(div);
  scrollToBottom();
}

// Help escape basic html structures for simple printing
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- Typing indicator bubble creator ---
function showTypingIndicator() {
  const messagesList = document.getElementById('messages-list');
  const div = document.createElement('div');
  div.id = "typing-indicator";
  div.className = "flex items-start gap-3 fade-in";
  
  div.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white flex items-center justify-center text-xs shadow-sm flex-shrink-0">
      <i class="fa-solid fa-wand-magic-sparkles"></i>
    </div>
    <div class="max-w-[70%] bg-white dark:bg-chatgray-900 border border-chatgray-200/80 dark:border-chatgray-800 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm select-none">
      <div class="flex items-center py-1">
        <div class="typing-dots flex items-center">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span class="text-xs text-chatgray-400 dark:text-chatgray-500 ml-2 font-medium">Gemini is thinking...</span>
      </div>
    </div>
  `;
  
  messagesList.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// --- Submit User Message Actions ---
async function handleChatSubmit(e) {
  e.preventDefault();
  
  if (isGenerating) return;
  
  const inputEl = document.getElementById('chat-input');
  const userText = inputEl.value.trim();
  if (userText === '') return;

  // Clear Input Field & reset sizes
  inputEl.value = '';
  inputEl.style.height = 'auto';
  document.getElementById('send-btn').disabled = true;

  // Force-hide warning panels
  hideQuotaWarning();

  // Load target session model messages
  const chat = conversations.find(c => c.id === currentChatId);
  if (!chat) return;

  // If first message in chat, change discussion title naturally
  const isFirstMessage = chat.messages.length === 0;

  // Clear dashboard welcome views
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('messages-list').classList.remove('hidden');

  // Push User message info
  const userMsg = { role: 'user', text: userText };
  chat.messages.push(userMsg);
  appendMessageHTML('user', userText);

  if (isFirstMessage) {
    // Pick the first 4 words of the prompt as title
    const titleWords = userText.split(' ').slice(0, 4).join(' ');
    chat.title = titleWords + (userText.split(' ').length > 4 ? '...' : '');
    document.getElementById('current-chat-title').textContent = chat.title;
    renderHistory();
  }

  // Update backend persistence arrays
  safeStorage.setItem('gemini_conversations', JSON.stringify(conversations));

  // Request API Key
  const apiKey = getApiKey();
  if (!apiKey || apiKey === "" || apiKey === "MY_GEMINI_API_KEY" || apiKey.startsWith("MY_")) {
    appendMessageHTML('model', "❌ **API Key Error**: The Gemini API Key is missing or not configured yet.\n\nTo configure, please register your API key in the **Secrets panel** inside **Google AI Studio** with the key name `GEMINI_API_KEY`.");
    return;
  }

  // AI Response triggers
  isGenerating = true;
  showTypingIndicator();

  try {
    const aiResponseText = await callGeminiAPI(apiKey, chat.messages);
    
    removeTypingIndicator();
    
    // Simulate ChatGPT gradual typing animation
    simulateTypingEffect(aiResponseText, chat);

  } catch (error) {
    removeTypingIndicator();
    isGenerating = false;
    
    console.error("API Call failed:", error);
    showQuotaWarning(error.message || "Request timed out or quota exhausted.");
    
    const errorMsg = { 
      role: 'model', 
      text: "⚠️ **Quota Error / Rate Limit**: We encountered an issue executing your API query. The Gemini API quota might have run out or generated a rate limit. Please verify credentials or try again later." 
    };
    chat.messages.push(errorMsg);
    appendMessageHTML('model', errorMsg.text);
    safeStorage.setItem('gemini_conversations', JSON.stringify(conversations));
  }
}

// --- Call Gemini API REST Endpoint ---
async function callGeminiAPI(key, messagesHistory) {
  const modelName = 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;

  // Format historical contents to match Gemini conversation structure:
  const formattedContents = messagesHistory.map(item => ({
    role: item.role,
    parts: [{ text: item.text }]
  }));

  const requestBody = {
    contents: formattedContents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
    systemInstruction: {
      parts: [{ text: systemInstructions }]
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    let parsedErr = {};
    try { parsedErr = JSON.parse(errText); } catch(e){}
    
    const message = (parsedErr.error && parsedErr.error.message) 
      ? parsedErr.error.message 
      : `HTTP Error: ${response.status} ${response.statusText}`;
    
    throw new Error(message);
  }

  const result = await response.json();
  const rawResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!rawResponse) {
    throw new Error("Empty candidate generated by the model. Model content may be blocked by safety filters.");
  }

  return rawResponse;
}

// --- Typing Simulator Incremental Loop ---
function simulateTypingEffect(fullText, chat) {
  // Rather than single character typing (which is extremely slow), we append in small word chunks
  const words = fullText.split(/(\s+)/);
  let displayedText = "";
  let wordIndex = 0;
  
  // Create an empty message element first
  const messagesList = document.getElementById('messages-list');
  const div = document.createElement('div');
  div.className = "flex flex-col space-y-2 fade-in group";
  
  const avatarBg = 'bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white';
  
  // Set basic container markup
  div.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-xs shadow-sm flex-shrink-0">
        <i class="fa-solid fa-wand-magic-sparkles"></i>
      </div>
      <div class="max-w-[84%] rounded-2xl px-4 py-3 bg-white dark:bg-chatgray-900 border border-chatgray-200/80 dark:border-chatgray-800 text-chatgray-950 dark:text-chatgray-100 rounded-tl-sm shadow-sm leading-relaxed">
        <div class="prose prose-sm max-w-none dark:prose-invert" id="typing-content-box">
          <!-- Text dynamically rendering here -->
        </div>
        <div class="mt-2.5 flex items-center gap-3 text-xs opacity-0 group-hover:opacity-100 transition float-right border-t border-chatgray-100 dark:border-chatgray-850 pt-1.5 w-full justify-end select-none">
          <button onclick="copyBubbleText(this)" class="flex items-center gap-1 text-chatgray-450 dark:text-chatgray-505 hover:text-indigo-405 hover:bg-chatgray-100 dark:hover:bg-chatgray-800 py-0.5 px-1.5 rounded transition" data-raw="">
            <i class="fa-regular fa-copy"></i>
            <span>Copy text</span>
          </button>
        </div>
      </div>
    </div>
  `;
  
  messagesList.appendChild(div);
  const textContainer = div.querySelector('#typing-content-box');
  const copyButton = div.querySelector('button[onclick="copyBubbleText(this)"]');
  
  // Chunking typist interval
  const timer = setInterval(() => {
    if (wordIndex < words.length) {
      displayedText += words[wordIndex];
      // Render parsed Markdown in real time
      textContainer.innerHTML = marked.parse(displayedText);
      
      // Highlight dynamically loaded blocks info
      textContainer.querySelectorAll('pre code').forEach((el) => {
        hljs.highlightElement(el);
      });
      
      wordIndex++;
      scrollToBottom();
    } else {
      clearInterval(timer);
      
      // Update Copy raw attributes
      copyButton.setAttribute('data-raw', encodeURIComponent(fullText));
      
      // Store fully generated string in history states
      const modelMsg = { role: 'model', text: fullText };
      chat.messages.push(modelMsg);
      safeStorage.setItem('gemini_conversations', JSON.stringify(conversations));
      
      // Reset variables
      isGenerating = false;
    }
  }, 12);
}

// --- Utility Action Triggers ---
function copyBubbleText(btn) {
  const encodedText = btn.getAttribute('data-raw');
  if (!encodedText) return;
  const rawText = decodeURIComponent(encodedText);
  
  navigator.clipboard.writeText(rawText).then(() => {
    const label = btn.querySelector('span');
    const icon = btn.querySelector('i');
    
    label.textContent = "Copied!";
    icon.className = "fa-solid fa-check text-green-500";
    
    setTimeout(() => {
      label.textContent = "Copy text";
      icon.className = "fa-regular fa-copy";
    }, 2000);
  }).catch(err => {
    console.error("Paste Clipboard copy error: ", err);
  });
}

function copyRawCode(btn) {
  const encodedCode = btn.getAttribute('data-code');
  if (!encodedCode) return;
  const rawCode = decodeURIComponent(encodedCode);
  
  navigator.clipboard.writeText(rawCode).then(() => {
    const label = btn.querySelector('span');
    const icon = btn.querySelector('i');
    
    label.textContent = "Copied!";
    icon.className = "fa-solid fa-check text-green-500";
    
    setTimeout(() => {
      label.textContent = "Copy code";
      icon.className = "fa-regular fa-copy";
    }, 2000);
  }).catch(err => {
    console.error("Codeblock Copy operation failed: ", err);
  });
}

// --- Error Alert Functions ---
function showQuotaWarning(errorText) {
  const badge = document.getElementById('quota-warning-badge');
  const span = document.getElementById('warning-text');
  
  if (badge && span) {
    span.textContent = `API Quota limit reached: ${errorText}`;
    badge.classList.remove('hidden');
  }
}

function hideQuotaWarning() {
  const badge = document.getElementById('quota-warning-badge');
  if (badge) {
    badge.classList.add('hidden');
  }
}
