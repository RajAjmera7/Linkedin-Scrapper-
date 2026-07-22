// App State
let leads = [];
let queries = [];
let scraperInterval = null;
let currentPitchPostId = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initQueries();
  initLeads();
  initScraperController();
  initHelpGuide();
  
  // Initial Loads
  fetchQueries();
  fetchLeads();
  checkScraperStatus();
  
  // Auto check scraper status on interval if running
  setInterval(checkScraperStatus, 3000);

  // Auto show help guide on first visit
  if (!localStorage.getItem('visitedBefore')) {
    setTimeout(() => {
      openHelpModal();
      localStorage.setItem('visitedBefore', 'true');
    }, 1000);
  }
});

function initHelpGuide() {
  const helpBtn = document.getElementById('help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', openHelpModal);
  }
}

function openHelpModal() {
  const modal = document.getElementById('help-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// 1. Navigation Controller
function initNavigation() {
  const menuItems = document.querySelectorAll('.menu-item');
  const sections = document.querySelectorAll('.content-section');
  const pageTitle = document.getElementById('page-title-text');

  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      
      // Update sidebar active state
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      // Switch sections
      sections.forEach(sec => sec.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
      
      // Update top header title
      const titleText = item.querySelector('span').innerText;
      pageTitle.innerText = titleText;

      // Hide notification badge if entering terminal
      if (targetId === 'terminal-section') {
        document.querySelector('#menu-terminal-btn .active-dot').classList.add('hidden');
      }
    });
  });
}

// 2. Leads & Stats Controller
function initLeads() {
  // Search & Filter Listeners
  document.getElementById('lead-search').addEventListener('input', filterLeads);
  document.getElementById('status-filter').addEventListener('change', filterLeads);
  document.getElementById('query-filter').addEventListener('change', filterLeads);
  
  // Modal close handlers
  document.getElementById('copy-pitch-btn').addEventListener('click', copyPitchText);
  document.getElementById('pitch-template').addEventListener('change', regeneratePitch);
  document.getElementById('pitch-role').addEventListener('input', debounce(regeneratePitch, 500));
}

async function fetchLeads() {
  try {
    const res = await fetch('/api/posts');
    leads = await res.json();
    renderLeads();
    updateStats();
  } catch (err) {
    console.error('Error fetching leads:', err);
  }
}

function renderLeads() {
  const container = document.getElementById('leads-list');
  const emptyState = document.getElementById('leads-empty');
  
  // Clear list except empty state
  const cards = container.querySelectorAll('.lead-card');
  cards.forEach(c => c.remove());

  const filtered = getFilteredLeads();

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  filtered.forEach(lead => {
    const card = document.createElement('div');
    card.className = `lead-card status-${lead.status.toLowerCase()}`;
    card.dataset.id = lead.id;

    // Get initials for profile placeholder
    const initials = lead.authorName
      ? lead.authorName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
      : 'LU';

    // Format text summary
    const contentHtml = lead.content
      ? lead.content.replace(/\n/g, '<br>')
      : '<span class="text-muted">No text content</span>';

    card.innerHTML = `
      <div class="lead-header">
        <div class="author-info">
          <div class="author-avatar">${initials}</div>
          <div class="author-meta">
            ${lead.authorUrl 
              ? `<a href="${lead.authorUrl}" target="_blank" class="author-name">${lead.authorName} <i data-lucide="external-link" style="width:12px; height:12px;"></i></a>` 
              : `<span class="author-name">${lead.authorName}</span>`}
            <span class="author-headline">${lead.authorHeadline || 'LinkedIn Member'}</span>
          </div>
        </div>
        <div class="post-meta">
          <span class="post-time">${lead.timeElapsed}</span>
          <span class="query-tag">${lead.queryTitle}</span>
        </div>
      </div>
      <div class="lead-body">${contentHtml}</div>
      
      <div class="lead-notes">
        <label style="display:block; font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Internal Notes (Click to edit)</label>
        <textarea placeholder="Add status notes here... (auto-saves)" rows="1" onblur="saveNotes('${lead.id}', this.value)" oninput="autoGrow(this)">${lead.notes || ''}</textarea>
      </div>

      <div class="lead-footer">
        <div class="lead-actions-left">
          <select class="status-dropdown" onchange="updateLeadStatus('${lead.id}', this.value)">
            <option value="New" ${lead.status === 'New' ? 'selected' : ''}>New</option>
            <option value="Saved" ${lead.status === 'Saved' ? 'selected' : ''}>Saved</option>
            <option value="Contacted" ${lead.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
            <option value="Ignored" ${lead.status === 'Ignored' ? 'selected' : ''}>Ignored</option>
          </select>
          <button class="btn btn-sm" onclick="deleteLead('${lead.id}')">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
        <div class="lead-actions-right">
          ${lead.url ? `<a href="${lead.url}" target="_blank" class="btn btn-sm"><i data-lucide="linkedin"></i> View Post</a>` : ''}
          <button class="btn btn-primary btn-sm" onclick="openPitchModal('${lead.id}', '${lead.queryTitle || ''}')">
            <i data-lucide="wand-2"></i>
            <span>Draft Pitch</span>
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  lucide.createIcons();
}

function getFilteredLeads() {
  const searchVal = document.getElementById('lead-search').value.toLowerCase();
  const statusFilter = document.getElementById('status-filter').value;
  const queryFilter = document.getElementById('query-filter').value;

  return leads.filter(lead => {
    const matchesSearch = !searchVal || 
      (lead.content && lead.content.toLowerCase().includes(searchVal)) ||
      (lead.authorName && lead.authorName.toLowerCase().includes(searchVal)) ||
      (lead.authorHeadline && lead.authorHeadline.toLowerCase().includes(searchVal));

    const matchesStatus = statusFilter === 'ALL' || lead.status === statusFilter;
    const matchesQuery = queryFilter === 'ALL' || lead.queryId === queryFilter;

    return matchesSearch && matchesStatus && matchesQuery;
  });
}

function filterLeads() {
  renderLeads();
}

function updateStats() {
  const total = leads.length;
  const newLeads = leads.filter(l => l.status === 'New').length;
  const contacted = leads.filter(l => l.status === 'Contacted').length;
  const ignored = leads.filter(l => l.status === 'Ignored').length;

  document.getElementById('stat-total').innerText = total;
  document.getElementById('stat-new').innerText = newLeads;
  document.getElementById('stat-contacted').innerText = contacted;
  document.getElementById('stat-ignored').innerText = ignored;
}

async function updateLeadStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    
    if (res.ok) {
      // Update local state
      const post = leads.find(p => p.id === id);
      if (post) post.status = newStatus;
      
      // Re-sort or update visual indicator
      const card = document.querySelector(`.lead-card[data-id="${id}"]`);
      if (card) {
        card.className = `lead-card status-${newStatus.toLowerCase()}`;
      }
      updateStats();
    }
  } catch (err) {
    console.error('Error updating status:', err);
  }
}

async function saveNotes(id, notes) {
  try {
    await fetch(`/api/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });
    
    // Update local state
    const post = leads.find(p => p.id === id);
    if (post) post.notes = notes;
  } catch (err) {
    console.error('Error saving notes:', err);
  }
}

async function deleteLead(id) {
  if (!confirm('Are you sure you want to remove this lead?')) return;
  try {
    const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      leads = leads.filter(l => l.id !== id);
      renderLeads();
      updateStats();
    }
  } catch (err) {
    console.error('Error deleting lead:', err);
  }
}

// 3. Search Queries Controller
function initQueries() {
  document.getElementById('add-query-btn').addEventListener('click', () => {
    openQueryModal();
  });

  document.getElementById('query-form').addEventListener('submit', handleQuerySubmit);
}

async function fetchQueries() {
  try {
    const res = await fetch('/api/queries');
    queries = await res.json();
    renderQueries();
    populateQueryFilters();
  } catch (err) {
    console.error('Error fetching queries:', err);
  }
}

function renderQueries() {
  const container = document.getElementById('queries-list');
  container.innerHTML = '';

  if (queries.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i data-lucide="search"></i>
        <h3>No search queries defined</h3>
        <p>Click "Add Query" above to configure your first search string.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  queries.forEach(query => {
    const card = document.createElement('div');
    card.className = 'query-card';
    card.innerHTML = `
      <div class="query-card-header">
        <h3 class="query-card-title">${query.title}</h3>
        <label class="switch">
          <input type="checkbox" ${query.active ? 'checked' : ''} onchange="toggleQueryActive('${query.id}', this.checked)">
          <span class="slider"></span>
        </label>
      </div>
      <div class="query-card-body">${escapeHtml(query.keywords)}</div>
      <div class="query-card-footer">
        <span class="text-muted" style="font-size: 12px;">Status: ${query.active ? 'Active' : 'Disabled'}</span>
        <div class="query-actions">
          <button class="btn btn-sm" onclick="openQueryModal('${query.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteQuery('${query.id}')">Delete</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
  lucide.createIcons();
}

function populateQueryFilters() {
  const filterDropdown = document.getElementById('query-filter');
  
  // Save current value
  const currentVal = filterDropdown.value;
  
  filterDropdown.innerHTML = '<option value="ALL">All Queries</option>';
  
  queries.forEach(q => {
    const opt = document.createElement('option');
    opt.value = q.id;
    opt.innerText = q.title;
    filterDropdown.appendChild(opt);
  });

  // Restore value if it still exists
  if (queries.some(q => q.id === currentVal)) {
    filterDropdown.value = currentVal;
  }
}

async function toggleQueryActive(id, isActive) {
  const query = queries.find(q => q.id === id);
  if (!query) return;

  try {
    const res = await fetch('/api/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...query, active: isActive })
    });
    
    if (res.ok) {
      query.active = isActive;
      fetchQueries(); // reload lists and filter
    }
  } catch (err) {
    console.error('Error toggling query state:', err);
  }
}

function openQueryModal(id = null) {
  const modal = document.getElementById('query-modal');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('query-form');
  
  form.reset();
  document.getElementById('query-id').value = '';

  if (id) {
    title.innerText = 'Edit Search Query';
    const query = queries.find(q => q.id === id);
    if (query) {
      document.getElementById('query-id').value = query.id;
      document.getElementById('query-title').value = query.title;
      document.getElementById('query-keywords').value = query.keywords;
    }
  } else {
    title.innerText = 'Add Search Query';
  }

  modal.classList.add('active');
}

async function handleQuerySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('query-id').value || null;
  const title = document.getElementById('query-title').value.trim();
  const keywords = document.getElementById('query-keywords').value.trim();

  const queryPayload = { title, keywords };
  if (id) queryPayload.id = id;

  try {
    const res = await fetch('/api/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryPayload)
    });

    if (res.ok) {
      closeModal('query-modal');
      fetchQueries();
    }
  } catch (err) {
    console.error('Error saving query:', err);
  }
}

async function deleteQuery(id) {
  if (!confirm('Are you sure you want to delete this query configuration?')) return;
  try {
    const res = await fetch(`/api/queries/${id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchQueries();
    }
  } catch (err) {
    console.error('Error deleting query:', err);
  }
}

// 4. Scraper Controller & Console Logger
function initScraperController() {
  const startBtn = document.getElementById('start-scraper-btn');
  const stopBtn = document.getElementById('stop-scraper-btn');

  startBtn.addEventListener('click', startScraper);
  stopBtn.addEventListener('click', stopScraper);
}

async function startScraper() {
  try {
    const res = await fetch('/api/scrape/start', { method: 'POST' });
    if (res.ok) {
      appendLog('[SYSTEM] Scraper run initiated successfully.');
      updateScraperUI(true);
      // Switch view to terminal section so user can see it starting
      document.querySelector('.menu-item[data-target="terminal-section"]').click();
    } else {
      const err = await res.json();
      alert('Error starting scraper: ' + err.error);
    }
  } catch (err) {
    console.error('Scraper launch failed:', err);
  }
}

async function stopScraper() {
  try {
    const res = await fetch('/api/scrape/stop', { method: 'POST' });
    if (res.ok) {
      appendLog('[SYSTEM] Sent termination signal to scraper process.');
    }
  } catch (err) {
    console.error('Error stopping scraper:', err);
  }
}

let lastLogLength = 0;
async function checkScraperStatus() {
  try {
    const res = await fetch('/api/scrape/status');
    const data = await res.json();

    updateScraperUI(data.running);

    if (data.logs && data.logs.length > lastLogLength) {
      // Append new logs
      const container = document.getElementById('terminal-logs');
      const isTerminalActive = document.getElementById('terminal-section').classList.contains('active');

      for (let i = lastLogLength; i < data.logs.length; i++) {
        const line = data.logs[i];
        const lineDiv = document.createElement('div');
        lineDiv.className = 'terminal-line';
        
        if (line.includes('[SYSTEM]')) {
          lineDiv.classList.add('system');
        } else if (line.includes('[ERROR]')) {
          lineDiv.classList.add('error');
        } else if (line.includes('[NEW LEAD]')) {
          lineDiv.classList.add('success');
        }

        lineDiv.innerText = line;
        container.appendChild(lineDiv);
      }

      container.scrollTop = container.scrollHeight;
      lastLogLength = data.logs.length;

      // Show notification badge on console sidebar tab if user is on a different screen
      if (!isTerminalActive && lastLogLength > 0) {
        document.querySelector('#menu-terminal-btn .active-dot').classList.remove('hidden');
      }
    }

    // If scraper was running and stopped, reload leads
    if (!data.running && scraperInterval) {
      clearInterval(scraperInterval);
      scraperInterval = null;
      fetchLeads(); // Reload leads automatically
      appendLog('[SYSTEM] Scraper completed. Leads table reloaded.');
    } else if (data.running && !scraperInterval) {
      // Keep checking quickly if running
      scraperInterval = setInterval(checkScraperStatus, 1500);
    }

  } catch (err) {
    console.error('Error checking status:', err);
  }
}

function updateScraperUI(isRunning) {
  const pulse = document.getElementById('scraper-pulse');
  const statusText = document.getElementById('scraper-status-text');
  const startBtn = document.getElementById('start-scraper-btn');
  const stopBtn = document.getElementById('stop-scraper-btn');

  if (isRunning) {
    pulse.className = 'pulse-dot running';
    statusText.innerText = 'Scraper Running...';
    startBtn.disabled = true;
    startBtn.innerHTML = '<i data-lucide="loader" class="spin"></i><span>Scraping...</span>';
    stopBtn.classList.remove('hidden');
  } else {
    pulse.className = 'pulse-dot idle';
    statusText.innerText = 'Scraper Idle';
    startBtn.disabled = false;
    startBtn.innerHTML = '<i data-lucide="play"></i><span>Run Scraper</span>';
    stopBtn.classList.add('hidden');
  }
  lucide.createIcons();
}

function appendLog(message, type = 'system') {
  const container = document.getElementById('terminal-logs');
  const lineDiv = document.createElement('div');
  lineDiv.className = `terminal-line ${type}`;
  lineDiv.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
  container.appendChild(lineDiv);
  container.scrollTop = container.scrollHeight;
}

// 5. Outreach Pitch Generator
async function openPitchModal(id, defaultRole) {
  currentPitchPostId = id;
  const modal = document.getElementById('pitch-modal');
  
  // Seed inputs
  document.getElementById('pitch-role').value = defaultRole;
  document.getElementById('pitch-template').value = 'direct';
  
  modal.classList.add('active');
  await generatePitch();
}

async function generatePitch() {
  if (!currentPitchPostId) return;

  const role = document.getElementById('pitch-role').value.trim();
  const templateType = document.getElementById('pitch-template').value;
  const textarea = document.getElementById('pitch-text');

  textarea.value = 'Drafting outreach pitch...';

  try {
    const res = await fetch(`/api/posts/${currentPitchPostId}/pitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateType, customRole: role })
    });
    
    if (res.ok) {
      const data = await res.json();
      textarea.value = data.pitch;
    } else {
      textarea.value = 'Failed to generate pitch.';
    }
  } catch (err) {
    console.error('Error generating pitch:', err);
    textarea.value = 'Server connection error.';
  }
}

async function regeneratePitch() {
  await generatePitch();
}

function copyPitchText() {
  const textarea = document.getElementById('pitch-text');
  textarea.select();
  document.execCommand('copy');
  
  const btn = document.getElementById('copy-pitch-btn');
  const btnSpan = btn.querySelector('span');
  
  btnSpan.innerText = 'Copied!';
  btn.classList.add('btn-primary');
  
  setTimeout(() => {
    btnSpan.innerText = 'Copy';
    btn.classList.remove('btn-primary');
  }, 2000);
}

// Global UI Helpers
window.closeModal = function(id) {
  document.getElementById(id).classList.remove('active');
};

window.saveNotes = saveNotes;
window.updateLeadStatus = updateLeadStatus;
window.deleteLead = deleteLead;
window.openPitchModal = openPitchModal;
window.toggleQueryActive = toggleQueryActive;
window.openQueryModal = openQueryModal;
window.deleteQuery = deleteQuery;

// General Utilities
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function autoGrow(element) {
  element.style.height = "5px";
  element.style.height = (element.scrollHeight) + "px";
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
