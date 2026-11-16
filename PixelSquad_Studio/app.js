// Suno Studio ACE-Step 1.5 Client State & Controller

let currentTracks = [];
let activeTrackIndex = -1;
let currentFilter = 'all';
let currentNavTab = 'home';
let currentStudioMode = 'custom';
let uploadedAudioPath = null;
let isPlaying = false;
let isMuted = false;
let isLooping = false;
let activePollingInterval = null;

// PixelSquad & Suno Creation Engine State (@image1)
let selectedVocalGender = 'auto'; // 'auto', 'male', 'female'
let selectedVoiceArtist = 'auto';
let durationMode = 'auto'; // 'auto', 'custom'
let maxModeEnabled = false;
let weirdnessValue = 50;
let styleInfluenceValue = 50;
let varietyValue = 'normal'; // 'low', 'normal', 'high'
let personalizeEnabled = false;

const VOICE_ARTISTS = {
  auto: { name: 'Auto AI', gender: 'auto', prompt: '' },
  bollywood_male_romantic: { name: 'Bollywood Romantic', gender: 'male', prompt: 'soulful emotional male playback vocals, expressive Indian melodic nuances, heartfelt chest voice' },
  desi_hardcore_rap: { name: 'Desi Rap Baritone', gender: 'male', prompt: 'aggressive punchy male baritone rap vocals, fast rhythmic Hindi delivery, hard-hitting vocal presence' },
  punjabi_power_male: { name: 'Punjabi Power Folk', gender: 'male', prompt: 'high-energy resonant Punjabi male vocals, folk nuances, powerful vibrato' },
  bollywood_nightingale: { name: 'Bollywood Nightingale', gender: 'female', prompt: 'silky smooth classical melodic female vocals, delicate Indian ornamentation, crystal-clear high notes' },
  modern_pop_female: { name: 'Modern Pop / R&B', gender: 'female', prompt: 'crisp modern pop female vocals, confident bright radio vocal timbre, contemporary cadence' },
  indie_acoustic_singer: { name: 'Indie Singer-Songwriter', gender: 'auto', prompt: 'intimate breathy acoustic singer-songwriter vocals, raw emotional authenticity' },
  sufi_ghazal_master: { name: 'Sufi / Ghazal Maestro', gender: 'male', prompt: 'deep devotional sufi vocals, traditional ghazal harkats, resonant acoustic presence' },
  custom: { name: 'Custom Persona', gender: 'auto', prompt: '' }
};

// Audio visualizer state
let audioCtx = null;
let analyser = null;
let visualizerRunning = false;

const audioPlayer = document.getElementById('globalAudioPlayer');

// DOM Elements
const tracksContainer = document.getElementById('tracksContainer');
const lyricsInput = document.getElementById('lyricsInput');
const styleInput = document.getElementById('styleInput');
const titleInput = document.getElementById('titleInput');
const simpleDescInput = document.getElementById('simpleDescInput');
const instrumentalToggle = document.getElementById('instrumentalToggle');
const durationSlider = document.getElementById('durationSlider');
const durationValLabel = document.getElementById('durationValLabel');
const bpmInput = document.getElementById('bpmInput');
const keyInput = document.getElementById('keyInput');
const customModeToggle = document.getElementById('customModeToggle');
const lyricsSection = document.getElementById('lyricsSection');
const simpleModeSection = document.getElementById('simpleModeSection');
const createBtn = document.getElementById('createBtn');
const generationProgressCard = document.getElementById('generationProgressCard');
const progressStatusText = document.getElementById('progressStatusText');
const progressPercentText = document.getElementById('progressPercentText');
const progressBarFill = document.getElementById('progressBarFill');
const searchInput = document.getElementById('searchInput');

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  fetchSystemStatus();
  refreshTracks();
  loadAvailableVoices();
  setupAudioEvents();
  setupSearch();
  initVisualizer();
  setupAudioDropZone();
  restorePersonalizeTaste();
  
  // Reconnect to active background generation if page was reloaded
  try {
    const activeTaskId = localStorage.getItem('ps_active_task_id');
    if (activeTaskId) {
      pollGenerationProgress(activeTaskId);
    }
  } catch (e) {}
});

// Theme Management (Light White by default, Dark Obsidian, B&W Monochrome)
let currentTheme = 'light';

function initTheme() {
  currentTheme = 'light';
  applyTheme('light');
  try {
    localStorage.setItem('ps_theme', 'light');
  } catch (e) {}
}

function toggleTheme() {
  if (currentTheme === 'light') {
    currentTheme = 'dark';
  } else if (currentTheme === 'dark') {
    currentTheme = 'bw';
  } else {
    currentTheme = 'light';
  }
  applyTheme(currentTheme);
  try {
    localStorage.setItem('ps_theme', currentTheme);
  } catch (e) {}
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const themeLabel = document.getElementById('themeLabel');
  const themeIcon = document.getElementById('themeIcon');
  if (theme === 'bw') {
    if (themeLabel) themeLabel.textContent = 'Theme: B&W';
    if (themeIcon) themeIcon.setAttribute('data-lucide', 'contrast');
  } else if (theme === 'light') {
    if (themeLabel) themeLabel.textContent = 'Theme: Light';
    if (themeIcon) themeIcon.setAttribute('data-lucide', 'sun');
  } else {
    if (themeLabel) themeLabel.textContent = 'Theme: Dark';
    if (themeIcon) themeIcon.setAttribute('data-lucide', 'moon');
  }
  lucide.createIcons();
}

function restorePersonalizeTaste() {
  try {
    const saved = localStorage.getItem('ps_personalize');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.voiceArtist) {
        document.getElementById('voiceArtistSelect').value = data.voiceArtist;
        handleVoiceArtistChange(data.voiceArtist);
      }
      if (data.vocalGender) {
        setVocalGender(data.vocalGender);
      }
      setPersonalize(true);
    }
  } catch (e) {
    console.warn('Personalize restore err', e);
  }
}

// Fetch system telemetry
async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/system-status');
    const data = await res.json();
    if (data.gpu_name) {
      document.getElementById('gpuModelLabel').textContent = `${data.gpu_name} (${data.vram_gb}GB)`;
    }
  } catch (err) {
    console.warn('System status fetch failed:', err);
  }
}

// Fetch all generated songs from library
async function refreshTracks() {
  try {
    const res = await fetch('/api/tracks');
    const data = await res.json();
    currentTracks = data.tracks || [];
    renderTracks();
    updateLibraryBadges();
  } catch (err) {
    console.error('Failed to load tracks:', err);
  }
}

function updateLibraryBadges() {
  const count = currentTracks.length;
  const pill = document.getElementById('libraryCountPill');
  if (pill) pill.textContent = count;
  const totalBadge = document.getElementById('totalTracksHeaderBadge');
  if (totalBadge) totalBadge.textContent = `${count} tracks`;
}

// Render Suno-style track cards
function renderTracks() {
  const query = searchInput.value.toLowerCase().trim();
  
  const filtered = currentTracks.filter(track => {
    // Tab filter
    if (currentFilter === 'vocals' && track.instrumental) return false;
    if (currentFilter === 'instrumental' && !track.instrumental) return false;
    if (currentFilter === 'music' && track.is_dialogue) return false;
    if (currentFilter === 'dialogue' && !track.is_dialogue) return false;

    // Search query
    if (query) {
      const matchTitle = (track.title || '').toLowerCase().includes(query);
      const matchStyle = (track.caption || '').toLowerCase().includes(query);
      const matchLyrics = (track.lyrics || '').toLowerCase().includes(query);
      return matchTitle || matchStyle || matchLyrics;
    }
    return true;
  });

  let bannerHtml = '';
  if (currentNavTab === 'explore') {
    const musicCount = currentTracks.filter(t => !t.is_dialogue).length;
    const dialogueCount = currentTracks.filter(t => t.is_dialogue).length;
    bannerHtml = `
      <div class="explore-history-banner mb-4 p-4 rounded-2xl bg-gradient-to-r from-purple-900/30 via-indigo-900/20 to-brandSurface border border-purple-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0 shadow-inner">
            <i data-lucide="history" class="w-5 h-5"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              <span>Past Creations & Music History</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">${currentTracks.length} tracks recorded</span>
            </h3>
            <p class="text-xs text-slate-400 mt-0.5">Explore previously created music tracks & dialogues. Click any track to listen or reuse prompts.</p>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button onclick="setFilter('all')" class="text-xs px-2.5 py-1 rounded-lg ${currentFilter === 'all' ? 'bg-purple-600 text-white font-bold' : 'bg-white/10 hover:bg-white/20 text-slate-200'} transition cursor-pointer">All (${currentTracks.length})</button>
          <button onclick="setFilter('music')" class="text-xs px-2.5 py-1 rounded-lg ${currentFilter === 'music' ? 'bg-purple-600 text-white font-bold' : 'bg-white/10 hover:bg-white/20 text-slate-200'} transition cursor-pointer">🎵 Songs (${musicCount})</button>
          <button onclick="setFilter('dialogue')" class="text-xs px-2.5 py-1 rounded-lg ${currentFilter === 'dialogue' ? 'bg-purple-600 text-white font-bold' : 'bg-white/10 hover:bg-white/20 text-slate-200'} transition cursor-pointer">🎙️ Dialogues (${dialogueCount})</button>
          <button onclick="refreshTracks()" class="text-xs px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-300 flex items-center gap-1 transition cursor-pointer" title="Refresh tracks from disk">
            <i data-lucide="rotate-cw" class="w-3 h-3"></i> Sync
          </button>
        </div>
      </div>
    `;
  }

  if (filtered.length === 0) {
    tracksContainer.innerHTML = bannerHtml + `
      <div class="h-64 flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/10 rounded-2xl">
        <div class="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-slate-500 mb-3">
          <i data-lucide="music-4" class="w-6 h-6"></i>
        </div>
        <p class="text-sm font-semibold text-slate-300">No tracks found</p>
        <p class="text-xs text-slate-500 mt-1 max-w-xs">No previous creations match the selected filter. Try selecting 'All History'.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  tracksContainer.innerHTML = bannerHtml + filtered.map((track, idx) => {
    const realIndex = currentTracks.findIndex(t => t.id === track.id);
    const isCurrent = activeTrackIndex === realIndex;
    const isThisPlaying = isCurrent && isPlaying;
    
    // Non-colorful studio monochrome thumbnail
    const iconName = track.is_dialogue ? 'mic-2' : (track.instrumental ? 'disc' : 'music-2');

    return `
      <div class="song-card p-3.5 flex items-center gap-4 group ${isThisPlaying ? 'playing' : ''}" data-track-id="${track.id}">
        <!-- Non-colorful Studio Artwork Thumbnail with Play Overlay -->
        <div class="track-artwork-thumb relative w-14 h-14 rounded-xl shrink-0 overflow-hidden shadow-md flex items-center justify-center">
          <i data-lucide="${iconName}" class="w-6 h-6 text-slate-400 group-hover:text-white transition"></i>
          
          <!-- Play / Pause Overlay Button -->
          <button onclick="playTrackByIndex(${realIndex})" class="track-play-overlay absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" title="${isThisPlaying ? 'Pause' : 'Play'}">
            <div class="track-play-badge shadow-lg">
              <i data-lucide="${isThisPlaying ? 'pause' : 'play'}" class="track-play-icon ${isThisPlaying ? '' : 'ml-0.5'}"></i>
            </div>
          </button>
          
          <!-- Animated sound bars when playing -->
          ${isThisPlaying ? `
            <div class="absolute bottom-1.5 inset-x-0 flex items-end justify-center gap-0.5">
              <span class="wave-bar" style="animation-delay: 0.1s"></span>
              <span class="wave-bar" style="animation-delay: 0.3s"></span>
              <span class="wave-bar" style="animation-delay: 0.2s"></span>
            </div>
          ` : ''}
        </div>

        <!-- Track Info -->
        <div class="flex-1 min-w-0 pr-2">
          <div class="flex items-center gap-2 mb-1">
            <h3 class="text-sm font-bold text-white truncate hover:text-purple-400 cursor-pointer" onclick="playTrackByIndex(${realIndex})">${escapeHtml(track.title)}</h3>
            ${track.is_dialogue ? '<span class="dialogue-badge text-[9px] px-2 py-0.5 rounded font-extrabold uppercase tracking-wider">🎙️ DIALOGUE</span>' : (track.instrumental ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 font-bold border border-cyan-500/30">INST</span>' : '')}
            ${(track.mastered || track.bitrate === '320k') ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">✨ 320k Master</span>' : ''}
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-slate-400 font-mono">${formatDuration(track.duration)}</span>
          </div>

          <p class="text-xs text-slate-400 truncate">${escapeHtml(track.caption || (track.is_dialogue ? 'PixelSquad Dialogue Audio' : 'ACE-Step 1.5 Composition'))}</p>
          <div class="text-[10px] text-slate-500 mt-1 flex items-center gap-2">
            <span>${track.created_at}</span>
            ${track.bpm ? `<span>• ${track.bpm} BPM</span>` : ''}
            ${track.keyscale ? `<span>• ${track.keyscale}</span>` : ''}
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition shrink-0">
          <!-- Reuse Prompt / Lyrics -->
          <button onclick="reuseTrackParams(${realIndex})" class="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-purple-300 transition" title="Reuse Prompt & Lyrics">
            <i data-lucide="copy" class="w-4 h-4"></i>
          </button>

          <!-- View Lyrics -->
          <button onclick="openLyricsForTrack(${realIndex})" class="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-cyan-300 transition" title="View Full Lyrics">
            <i data-lucide="file-text" class="w-4 h-4"></i>
          </button>

          <!-- Re-master with Suno Studio Audio Engine -->
          <button onclick="remasterTrack('${track.id}', event)" class="p-2 rounded-lg hover:bg-amber-500/15 text-slate-400 hover:text-amber-300 transition" title="Apply Suno Studio Master (320k, EQ, Stereo Width, Limiter)">
            <i data-lucide="wand-2" class="w-4 h-4"></i>
          </button>

          <!-- Download Audio -->
          <a href="${track.audio_url}" download="${encodeURIComponent(track.title)}.mp3" class="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition" title="Download MP3">
            <i data-lucide="download" class="w-4 h-4"></i>
          </a>

          <!-- Delete -->
          <button onclick="deleteTrack('${track.id}')" class="p-2 rounded-lg hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 transition" title="Delete Track">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// ==========================================
// SUNO UI CONTROLS & MODEL SELECTOR
// ==========================================
let currentSunoModel = 'v6-mini';
let currentSunoTopTab = 'songs';

function switchCreateSubTab(tab) {
  return switchSunoTopTab(tab);
}

function setSongSubMode(mode) {
  return setSunoMode(mode);
}

function switchSunoTopTab(tab) {
  currentSunoTopTab = tab;
  const songsBtn = document.getElementById('topTabSongs');
  const speechBtn = document.getElementById('topTabSpeech');
  const songsControlRow = document.getElementById('songsControlRow');
  const plusAudioContainer = document.getElementById('plusAudioContainer');

  if (tab === 'songs') {
    if (songsBtn) {
      songsBtn.className = 'flex-1 pb-2.5 text-sm font-bold text-white border-b-2 border-white transition flex items-center justify-center gap-1.5 cursor-pointer';
    }
    if (speechBtn) {
      speechBtn.className = 'flex-1 pb-2.5 text-sm font-bold text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition flex items-center justify-center gap-1.5 cursor-pointer';
    }
    if (songsControlRow) songsControlRow.classList.remove('hidden');
    if (plusAudioContainer) plusAudioContainer.classList.remove('hidden');
    setSongSubMode('advanced');
  } else {
    if (speechBtn) {
      speechBtn.className = 'flex-1 pb-2.5 text-sm font-bold text-white border-b-2 border-white transition flex items-center justify-center gap-1.5 cursor-pointer';
    }
    if (songsBtn) {
      songsBtn.className = 'flex-1 pb-2.5 text-sm font-bold text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition flex items-center justify-center gap-1.5 cursor-pointer';
    }
    if (songsControlRow) songsControlRow.classList.add('hidden');
    if (plusAudioContainer) plusAudioContainer.classList.add('hidden');
    setStudioMode('dialogue');
  }
  lucide.createIcons();
}

function setSunoMode(mode) {
  const pillSimple = document.getElementById('pillSimpleBtn');
  const pillAdv = document.getElementById('pillAdvancedBtn');

  if (mode === 'simple') {
    if (pillSimple) {
      pillSimple.className = 'px-3.5 py-1 rounded-full bg-[#222533] text-white font-semibold transition cursor-pointer shadow-sm';
    }
    if (pillAdv) {
      pillAdv.className = 'px-3.5 py-1 rounded-full text-slate-400 hover:text-white transition font-medium cursor-pointer';
    }
    setStudioMode('simple');
  } else {
    if (pillAdv) {
      pillAdv.className = 'px-3.5 py-1 rounded-full bg-[#222533] text-white font-semibold transition cursor-pointer shadow-sm';
    }
    if (pillSimple) {
      pillSimple.className = 'px-3.5 py-1 rounded-full text-slate-400 hover:text-white transition font-medium cursor-pointer';
    }
    setStudioMode('custom');
  }
}

// Global window bindings for Suno Drawer Handlers
window.switchCreateSubTab = switchCreateSubTab;
window.setSongSubMode = setSongSubMode;
window.switchSunoTopTab = switchSunoTopTab;
window.setSunoMode = setSunoMode;

function toggleModelDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('modelDropdownMenu');
  const chevron = document.getElementById('modelDropdownChevron');
  if (menu) {
    menu.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate-180');
  }
}

// Global click-outside listener to close model dropdown
document.addEventListener('click', (e) => {
  const menu = document.getElementById('modelDropdownMenu');
  const btn = document.getElementById('modelSelectBtn');
  if (menu && !menu.classList.contains('hidden')) {
    if (btn && !btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add('hidden');
      const chevron = document.getElementById('modelDropdownChevron');
      if (chevron) chevron.classList.remove('rotate-180');
    }
  }
});

function selectModel(modelId, label) {
  currentSunoModel = modelId;
  const labelEl = document.getElementById('selectedModelLabel');
  if (labelEl) labelEl.textContent = label;

  // Toggle checkmarks
  ['v6-pro', 'v6-wild', 'v6-mini'].forEach(id => {
    const chk = document.getElementById(`check-${id}`);
    if (chk) {
      const btn = chk.closest('.model-opt-btn');
      if (id === modelId) {
        chk.classList.remove('hidden');
        if (btn) btn.classList.add('bg-white/10');
      } else {
        chk.classList.add('hidden');
        if (btn) btn.classList.remove('bg-white/10');
      }
    }
  });

  // Adjust engine tuning based on selected model
  const stepsSlider = document.getElementById('stepsSlider');
  const stepsVal = document.getElementById('stepsVal');
  const cfgSlider = document.getElementById('cfgSlider');
  const cfgVal = document.getElementById('cfgVal');
  const shiftSlider = document.getElementById('shiftSlider');
  const shiftVal = document.getElementById('shiftVal');

  if (modelId === 'v6-pro') {
    // v6 Pro: Studio Master Quality (8 turbo steps, 7.8 CFG)
    if (stepsSlider) { stepsSlider.value = 8; if (stepsVal) stepsVal.textContent = 8; const lbl = document.getElementById('stepsValLabel'); if (lbl) lbl.textContent = 8; }
    if (cfgSlider) { cfgSlider.value = 7.8; if (cfgVal) cfgVal.textContent = '7.8'; const lbl = document.getElementById('cfgValLabel'); if (lbl) lbl.textContent = '7.8'; }
    if (shiftSlider) { shiftSlider.value = 3.0; if (shiftVal) shiftVal.textContent = '3.0'; const lbl = document.getElementById('shiftValLabel'); if (lbl) lbl.textContent = '3.0'; }
  } else if (modelId === 'v6-wild') {
    // v6-wild Pro: Experimental ideas & wild styles (6 steps, 6.5 CFG, 4.5 timestep shift)
    if (stepsSlider) { stepsSlider.value = 6; if (stepsVal) stepsVal.textContent = 6; const lbl = document.getElementById('stepsValLabel'); if (lbl) lbl.textContent = 6; }
    if (cfgSlider) { cfgSlider.value = 6.5; if (cfgVal) cfgVal.textContent = '6.5'; const lbl = document.getElementById('cfgValLabel'); if (lbl) lbl.textContent = '6.5'; }
    if (shiftSlider) { shiftSlider.value = 4.5; if (shiftVal) shiftVal.textContent = '4.5'; const lbl = document.getElementById('shiftValLabel'); if (lbl) lbl.textContent = '4.5'; }
  } else {
    // v6-mini: Fast, ultra-responsive ACE-Step Turbo (4 steps, 7.0 CFG)
    if (stepsSlider) { stepsSlider.value = 4; if (stepsVal) stepsVal.textContent = 4; const lbl = document.getElementById('stepsValLabel'); if (lbl) lbl.textContent = 4; }
    if (cfgSlider) { cfgSlider.value = 7.0; if (cfgVal) cfgVal.textContent = '7.0'; const lbl = document.getElementById('cfgValLabel'); if (lbl) lbl.textContent = '7.0'; }
    if (shiftSlider) { shiftSlider.value = 3.0; if (shiftVal) shiftVal.textContent = '3.0'; const lbl = document.getElementById('shiftValLabel'); if (lbl) lbl.textContent = '3.0'; }
  }

  // Close dropdown
  const menu = document.getElementById('modelDropdownMenu');
  if (menu) menu.classList.add('hidden');
  const chevron = document.getElementById('modelDropdownChevron');
  if (chevron) chevron.classList.remove('rotate-180');
}

function toggleAudioUploadZone() {
  const container = document.getElementById('audioUploadContainer');
  if (container) {
    container.classList.toggle('hidden');
    if (!container.classList.contains('hidden')) {
      container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

window.toggleModelDropdown = toggleModelDropdown;
window.selectModel = selectModel;
window.toggleAudioUploadZone = toggleAudioUploadZone;

// Switch Studio Creation Modes (Custom, Simple, Remix / Cover, Repaint, Dialogue)
function setStudioMode(mode) {
  currentStudioMode = mode;
  const modes = ['custom', 'simple', 'cover', 'repaint', 'dialogue', 'cloner'];
  modes.forEach(m => {
    const tab = document.getElementById(`modeTab${m.charAt(0).toUpperCase() + m.slice(1)}`);
    if (tab) {
      if (m === mode) {
        if (m === 'dialogue') {
          tab.className = 'mode-tab-btn flex-1 py-1.5 px-2 rounded-lg bg-amber-500/25 text-amber-300 border border-amber-500/40 whitespace-nowrap flex items-center justify-center gap-1.5 transition font-semibold';
        } else if (m === 'cloner') {
          tab.className = 'mode-tab-btn flex-1 py-1.5 px-2 rounded-lg bg-rose-500/25 text-rose-300 border border-rose-500/40 whitespace-nowrap flex items-center justify-center gap-1.5 transition font-semibold';
        } else {
          tab.className = 'mode-tab-btn flex-1 py-1.5 px-2 rounded-lg bg-purple-600/30 text-purple-300 border border-purple-500/40 whitespace-nowrap flex items-center justify-center gap-1.5 transition font-semibold';
        }
      } else {
        tab.className = 'mode-tab-btn flex-1 py-1.5 px-2 rounded-lg text-slate-400 hover:text-white whitespace-nowrap flex items-center justify-center gap-1.5 transition font-semibold';
      }
    }
  });

  const audioUploadContainer = document.getElementById('audioUploadContainer');
  const coverStrengthSection = document.getElementById('coverStrengthSection');
  const repaintSection = document.getElementById('repaintSection');
  const audioUploadLabel = document.getElementById('audioUploadLabel');
  const dialogueModeSection = document.getElementById('dialogueModeSection');
  const clonerModeSection = document.getElementById('clonerModeSection');
  const musicCreationSections = document.getElementById('musicCreationSections');
  const createBtn = document.getElementById('createBtn');

  if (mode === 'cloner') {
    if (clonerModeSection) clonerModeSection.classList.remove('hidden');
    if (dialogueModeSection) dialogueModeSection.classList.add('hidden');
    if (musicCreationSections) musicCreationSections.classList.add('hidden');
    lyricsSection.classList.add('hidden');
    simpleModeSection.classList.add('hidden');
    audioUploadContainer.classList.add('hidden');
    coverStrengthSection.classList.add('hidden');
    repaintSection.classList.add('hidden');
    if (createBtn) createBtn.classList.add('hidden');
  } else if (mode === 'dialogue') {
    if (clonerModeSection) clonerModeSection.classList.add('hidden');
    if (dialogueModeSection) dialogueModeSection.classList.remove('hidden');
    if (musicCreationSections) musicCreationSections.classList.add('hidden');
    lyricsSection.classList.add('hidden');
    simpleModeSection.classList.add('hidden');
    audioUploadContainer.classList.add('hidden');
    coverStrengthSection.classList.add('hidden');
    repaintSection.classList.add('hidden');
    if (createBtn) {
      createBtn.classList.remove('hidden');
      createBtn.innerHTML = '<i data-lucide="sparkles" class="w-5 h-5"></i><span>Generate Dialogue Audio</span>';
      createBtn.className = 'btn-suno w-full py-3.5 text-base font-bold shadow-lg shadow-amber-900/40 bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-400 hover:to-purple-500';
    }
  } else {
    if (clonerModeSection) clonerModeSection.classList.add('hidden');
    if (dialogueModeSection) dialogueModeSection.classList.add('hidden');
    if (musicCreationSections) musicCreationSections.classList.remove('hidden');
    if (createBtn) {
      createBtn.classList.remove('hidden');
      createBtn.innerHTML = '<i data-lucide="sparkles" class="w-5 h-5"></i><span>Create Song</span>';
      createBtn.className = 'btn-suno w-full py-3.5 text-base font-bold shadow-lg shadow-purple-900/40';
    }

    if (mode === 'custom') {
      lyricsSection.classList.remove('hidden');
      simpleModeSection.classList.add('hidden');
      audioUploadContainer.classList.add('hidden');
      coverStrengthSection.classList.add('hidden');
      repaintSection.classList.add('hidden');
    } else if (mode === 'simple') {
      lyricsSection.classList.add('hidden');
      simpleModeSection.classList.remove('hidden');
      audioUploadContainer.classList.add('hidden');
      coverStrengthSection.classList.add('hidden');
      repaintSection.classList.add('hidden');
    } else if (mode === 'cover') {
      lyricsSection.classList.remove('hidden');
      simpleModeSection.classList.add('hidden');
      audioUploadContainer.classList.remove('hidden');
      audioUploadLabel.textContent = 'Reference / Source Audio for Remix & Cover';
      coverStrengthSection.classList.remove('hidden');
      repaintSection.classList.add('hidden');
    } else if (mode === 'repaint') {
      lyricsSection.classList.remove('hidden');
      simpleModeSection.classList.add('hidden');
      audioUploadContainer.classList.remove('hidden');
      audioUploadLabel.textContent = 'Source Audio for Inpainting & Repaint';
      coverStrengthSection.classList.add('hidden');
      repaintSection.classList.remove('hidden');
    }
  }
  lucide.createIcons();
}

// Handle audio upload for Cover / Repaint
async function handleAudioUpload(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) return;

  const dropZone = document.getElementById('dropZone');
  const filenameEl = document.getElementById('audioUploadFilename');
  const preview = document.getElementById('uploadedAudioPreview');

  filenameEl.textContent = `Uploading ${file.name}...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload-audio', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      uploadedAudioPath = data.file_path;
      filenameEl.textContent = `✓ ${file.name}`;
      preview.src = data.audio_url;
      preview.classList.remove('hidden');
    } else {
      alert('Upload failed: ' + (data.detail || 'Unknown error'));
      filenameEl.textContent = 'Upload failed';
    }
  } catch (err) {
    console.error('Audio upload error:', err);
    alert('Audio upload error: ' + err.message);
    filenameEl.textContent = 'Upload error';
  }
}

// Drawer Source Audio Mic Recording State
let drawerMediaRecorder = null;
let drawerAudioChunks = [];
let drawerRecInterval = null;
let drawerRecSeconds = 0;
let drawerAudioStream = null;

function toggleDrawerMicRecording() {
  if (drawerMediaRecorder && drawerMediaRecorder.state === 'recording') {
    stopDrawerMicRecording();
  } else {
    startDrawerMicRecording();
  }
}

async function startDrawerMicRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Microphone access is not supported by your browser or requires HTTPS / localhost.');
      return;
    }

    drawerAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
      mimeType = 'audio/ogg';
    }

    drawerAudioChunks = [];
    drawerMediaRecorder = new MediaRecorder(drawerAudioStream, { mimeType });

    drawerMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        drawerAudioChunks.push(e.data);
      }
    };

    drawerMediaRecorder.onstop = async () => {
      if (drawerRecInterval) {
        clearInterval(drawerRecInterval);
        drawerRecInterval = null;
      }
      
      if (drawerAudioStream) {
        drawerAudioStream.getTracks().forEach(t => t.stop());
        drawerAudioStream = null;
      }

      const recBox = document.getElementById('drawerRecordingBox');
      const btnText = document.getElementById('drawerMicBtnText');
      if (recBox) recBox.classList.add('hidden');
      if (btnText) btnText.textContent = 'Record Source Audio with Mic';

      if (drawerAudioChunks.length === 0) return;

      const audioBlob = new Blob(drawerAudioChunks, { type: mimeType });
      const ext = mimeType.includes('mp4') ? 'mp4' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
      const recordedFile = new File([audioBlob], `drawer_mic_${Date.now()}.${ext}`, { type: mimeType });

      const filenameEl = document.getElementById('audioUploadFilename');
      const preview = document.getElementById('uploadedAudioPreview');
      if (filenameEl) filenameEl.textContent = `Saving recorded mic audio...`;

      const formData = new FormData();
      formData.append('file', recordedFile);

      try {
        const res = await fetch('/api/upload-audio', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          uploadedAudioPath = data.file_path;
          if (filenameEl) filenameEl.textContent = `✓ Mic Recorded (${drawerRecSeconds}s)`;
          if (preview) {
            preview.src = data.audio_url;
            preview.classList.remove('hidden');
          }
        }
      } catch (err) {
        console.error('Drawer mic upload failed:', err);
        if (filenameEl) filenameEl.textContent = 'Upload failed';
      }
    };

    drawerMediaRecorder.start(250);
    drawerRecSeconds = 0;

    const recBox = document.getElementById('drawerRecordingBox');
    const timerEl = document.getElementById('drawerRecTimer');
    const btnText = document.getElementById('drawerMicBtnText');

    if (recBox) recBox.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Stop Recording';
    if (timerEl) timerEl.textContent = '00:00';

    drawerRecInterval = setInterval(() => {
      drawerRecSeconds++;
      const secs = drawerRecSeconds % 60;
      const mins = Math.floor(drawerRecSeconds / 60);
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (timerEl) timerEl.textContent = formatted;
    }, 1000);

  } catch (err) {
    console.error('Drawer mic error:', err);
    alert('Microphone access denied or error: ' + (err.message || 'Please check mic permissions.'));
    cancelDrawerMicRecording();
  }
}

function stopDrawerMicRecording() {
  if (drawerMediaRecorder && drawerMediaRecorder.state !== 'inactive') {
    drawerMediaRecorder.stop();
  }
}

function cancelDrawerMicRecording() {
  if (drawerMediaRecorder && drawerMediaRecorder.state !== 'inactive') {
    drawerAudioChunks = [];
    drawerMediaRecorder.stop();
  }
  if (drawerRecInterval) {
    clearInterval(drawerRecInterval);
    drawerRecInterval = null;
  }
  if (drawerAudioStream) {
    drawerAudioStream.getTracks().forEach(t => t.stop());
    drawerAudioStream = null;
  }
  const recBox = document.getElementById('drawerRecordingBox');
  const btnText = document.getElementById('drawerMicBtnText');
  if (recBox) recBox.classList.add('hidden');
  if (btnText) btnText.textContent = 'Record Source Audio with Mic';
}

// Setup drag and drop for audio box
function setupAudioDropZone() {
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('border-purple-500', 'bg-purple-950/30');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('border-purple-500', 'bg-purple-950/30');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleAudioUpload({ target: { files: files } });
    }
  });
}

// Smart AI Style Prompt Enhancer
function enhanceStylePrompt() {
  const current = styleInput.value.trim().toLowerCase();
  let enhanced = '';

  if (!current) {
    enhanced = 'Aggressive hardcore Hindi rap, heavy 808 sub-bass, punchy trap drums, dark menacing melody, fast rhythmic flow, 130 BPM, studio mastered';
  } else if (current.includes('rap') || current.includes('hip hop') || current.includes('drill')) {
    enhanced = `${styleInput.value.trim()}, heavy 808 sub-bass, crispy hi-hat rolls, dark brass stabs, punchy kick, clear aggressive vocal mix, 130 BPM, studio mastered`;
  } else if (current.includes('bollywood') || current.includes('indian') || current.includes('desi')) {
    enhanced = `${styleInput.value.trim()}, uplifting melodic chorus, acoustic guitar, authentic dholak and tabla grooves, lush Bollywood strings, bright stereo mix`;
  } else if (current.includes('lofi') || current.includes('chill') || current.includes('relax')) {
    enhanced = `${styleInput.value.trim()}, warm vintage Rhodes piano, mellow acoustic guitar, nostalgic vinyl crackle, gentle boombap drums, relaxed groove, 80 BPM`;
  } else if (current.includes('edm') || current.includes('dance') || current.includes('electronic')) {
    enhanced = `${styleInput.value.trim()}, powerful supersaw leads, massive energetic build-up, punchy club kick, euphoric festival drop, 128 BPM, wide stereo depth`;
  } else if (current.includes('rock') || current.includes('metal')) {
    enhanced = `${styleInput.value.trim()}, crunchy distorted guitar riffs, driving live rock drums, aggressive overdriven bass, raw powerful energy, 135 BPM`;
  } else {
    enhanced = `${styleInput.value.trim()}, rich studio instrumentation, crisp modern percussion, melodic harmonic layers, professional radio master`;
  }

  styleInput.value = enhanced;
  if (!titleInput.value) {
    titleInput.value = enhanced.split(',')[0].trim();
  }
}

// Auto-Format Lyrics into structured Verse / Chorus blocks
function enhanceLyricsStructure() {
  let text = lyricsInput.value.trim();
  if (!text) {
    lyricsInput.value = `[Intro]\nKal tak tha paisa, kal tak tha naam...\n\n[Verse 1]\nRaaton ko jaaga, din me ladta raha,\nHar ek thokar se aage badhta raha!\n\n[Chorus]\nAb meri baari hai! Ab meri taiyaari hai!\nJisne mujhe giraya, uski soch pe bhaari hai!\n\n[Drop]\nNa rukunga! Na jhukunga!\nAb har deewaar se bhidunga!\n\n[Outro]\nMain gira tha, haara nahi!\nAb meri baari hai!`;
    return;
  }

  // If lyrics already contain bracket tags, clean up spacing
  if (text.includes('[') && text.includes(']')) {
    text = text.replace(/\[\s+/g, '[').replace(/\s+\]/g, ']');
    lyricsInput.value = text;
    return;
  }

  // If bare text without tags, wrap logically
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length <= 4) {
    lyricsInput.value = `[Verse 1]\n${lines.join('\n')}\n\n[Chorus]\n${lines.slice(0, 2).join('\n')}`;
  } else {
    const half = Math.floor(lines.length / 2);
    lyricsInput.value = `[Verse 1]\n${lines.slice(0, half).join('\n')}\n\n[Chorus]\n${lines.slice(half).join('\n')}`;
  }
}

// Insert section tags at cursor position
function insertTag(tag) {
  const start = lyricsInput.selectionStart;
  const end = lyricsInput.selectionEnd;
  const text = lyricsInput.value;
  const newText = text.substring(0, start) + `\n${tag}\n` + text.substring(end);
  lyricsInput.value = newText;
  lyricsInput.focus();
  lyricsInput.selectionStart = lyricsInput.selectionEnd = start + tag.length + 2;
}

function clearLyrics() {
  lyricsInput.value = '';
}

function appendStyle(styleTag) {
  const current = styleInput.value.trim();
  if (!current) {
    styleInput.value = styleTag;
  } else if (!current.toLowerCase().includes(styleTag.toLowerCase())) {
    styleInput.value = `${current}, ${styleTag}`;
  }
}

// Random style surprise
const SURPRISE_STYLES = [
  'Aggressive Hardcore Hindi Rap, 808 Sub-Bass, Fast Angry Flow, 130 BPM',
  'Bollywood Romantic Pop, Warm Acoustic Guitar, Melodic Harmonies, Sitar, 95 BPM',
  'Punjabi Drill Anthem, Hard Distorted Bass, Energetic Tumbi, 140 BPM',
  'Lo-Fi Midnight Chillhop, Dusty Vinyl Crackle, Mellow Rhodes Piano, 82 BPM',
  '80s Retro Synthwave, Punchy Gated Drums, Analog Neon Arpeggios, 122 BPM',
  'High Energy EDM Festival Drop, Big Room Lead Synth, Heavy Bass, 128 BPM',
  'Soulful Ghazal Acoustic, Tabla Rhythm, Soft Harmonium, Emotional Flow, 75 BPM',
  'Modern Hard Rock, Heavy Distorted Guitars, Punchy Drums, Powerful Male Vocals, 135 BPM'
];

function randomizeStyle() {
  const rand = SURPRISE_STYLES[Math.floor(Math.random() * SURPRISE_STYLES.length)];
  styleInput.value = rand;
  if (!titleInput.value) {
    titleInput.value = rand.split(',')[0];
  }
}

// Preset vibes from left sidebar
function applyVibePreset(type) {
  setStudioMode('custom');
  if (type === 'hindi_rap') {
    styleInput.value = 'Aggressive hardcore Hindi rap, heavy bass, dark angry flow, 130 bpm';
    titleInput.value = 'Ab Meri Baari Hai';
  } else if (type === 'bollywood_pop') {
    styleInput.value = 'Uplifting Bollywood dance pop, bright acoustic guitar, energetic dhol, 120 bpm';
    titleInput.value = 'Dil Ki Dhadkan';
  } else if (type === 'lofi_chill') {
    styleInput.value = 'Chill Lo-Fi hip hop, relaxing mellow piano, vinyl crackle, 80 bpm';
    titleInput.value = 'Midnight Thoughts';
  } else if (type === 'edm_festival') {
    styleInput.value = 'Festival EDM anthem, massive euphoric synth drop, energetic kick, 128 bpm';
    titleInput.value = 'Euphoria Drop';
  }
}

function updateDurationLabel(val) {
  durationValLabel.textContent = `${val}s`;
}

// Reuse Prompt & Lyrics from existing song
function reuseTrackParams(index) {
  const track = currentTracks[index];
  if (!track) return;

  setStudioMode('custom');

  titleInput.value = track.title || '';
  lyricsInput.value = track.lyrics || '';
  styleInput.value = track.caption || '';
  instrumentalToggle.checked = track.instrumental || false;
  if (track.duration) {
    durationSlider.value = Math.min(Math.max(track.duration, 30), 240);
    updateDurationLabel(durationSlider.value);
  }
  if (track.bpm) bpmInput.value = track.bpm;
  if (track.keyscale) keyInput.value = track.keyscale;

  // Flash UI feedback
  titleInput.scrollIntoView({ behavior: 'smooth' });
}

// ========================================================
// PIXELSQUAD & SUNO CREATION ENGINE HANDLERS (@image1)
// ========================================================

function updateTuningSummaryBadge() {
  const badge = document.getElementById('tuningSummaryBadge');
  if (!badge) return;
  const gender = selectedVocalGender.toUpperCase();
  const max = maxModeEnabled ? ' • Max' : '';
  badge.textContent = `${gender} • ${styleInfluenceValue}% Style${max}`;
}

function setVocalGender(gender) {
  selectedVocalGender = gender;
  const autoBtn = document.getElementById('genderAutoBtn');
  const maleBtn = document.getElementById('genderMaleBtn');
  const femaleBtn = document.getElementById('genderFemaleBtn');
  if (autoBtn) autoBtn.classList.toggle('active', gender === 'auto');
  if (maleBtn) maleBtn.classList.toggle('active', gender === 'male');
  if (femaleBtn) femaleBtn.classList.toggle('active', gender === 'female');
  updateTuningSummaryBadge();
}

function handleVoiceArtistChange(key) {
  selectedVoiceArtist = key;
  const customInput = document.getElementById('customVoiceInput');
  const badge = document.getElementById('activeArtistBadge');
  
  if (key === 'custom') {
    if (customInput) {
      customInput.classList.remove('hidden');
      customInput.focus();
    }
    if (badge) badge.textContent = 'Custom';
  } else {
    if (customInput) customInput.classList.add('hidden');
    const artist = VOICE_ARTISTS[key];
    if (artist) {
      if (badge) badge.textContent = artist.name;
      if (artist.gender !== 'auto') {
        setVocalGender(artist.gender);
      }
    }
  }
}

function setDurationMode(mode) {
  durationMode = mode;
  const customBtn = document.getElementById('durCustomBtn');
  const autoBtn = document.getElementById('durAutoBtn');
  const customSec = document.getElementById('customDurationSection');
  if (customBtn) customBtn.classList.toggle('active', mode === 'custom');
  if (autoBtn) autoBtn.classList.toggle('active', mode === 'auto');
  if (customSec) {
    if (mode === 'custom') {
      customSec.classList.remove('hidden');
    } else {
      customSec.classList.add('hidden');
    }
  }
}

function setMaxMode(enabled) {
  maxModeEnabled = enabled;
  const offBtn = document.getElementById('maxModeOffBtn');
  const onBtn = document.getElementById('maxModeOnBtn');
  if (offBtn) offBtn.classList.toggle('active', !enabled);
  if (onBtn) onBtn.classList.toggle('active', enabled);
  updateTuningSummaryBadge();
}

function updateWeirdness(val) {
  weirdnessValue = parseInt(val);
  const el = document.getElementById('weirdnessVal');
  if (el) el.textContent = `${val}%`;
}

function updateStyleInfluence(val) {
  styleInfluenceValue = parseInt(val);
  const el = document.getElementById('styleInfluenceVal');
  if (el) el.textContent = `${val}%`;
  updateTuningSummaryBadge();
}

function updateVariety(val) {
  const num = parseInt(val);
  let label = 'Normal';
  let mode = 'normal';
  if (num <= 3) {
    label = 'Low';
    mode = 'low';
  } else if (num >= 7) {
    label = 'High';
    mode = 'high';
  } else {
    label = 'Normal';
    mode = 'normal';
  }
  varietyValue = mode;
  const el = document.getElementById('varietyVal');
  if (el) el.textContent = label;
}

function setPersonalize(enabled) {
  personalizeEnabled = enabled;
  const offBtn = document.getElementById('personalizeOffBtn');
  const onBtn = document.getElementById('personalizeOnBtn');
  if (offBtn) offBtn.classList.toggle('active', !enabled);
  if (onBtn) onBtn.classList.toggle('active', enabled);
  if (enabled) {
    localStorage.setItem('ps_personalize', JSON.stringify({
      voiceArtist: selectedVoiceArtist,
      vocalGender: selectedVocalGender,
      style: styleInput.value
    }));
  }
}

function handleInstrumentalToggle(isChecked) {
  const genderRow = document.getElementById('genderAutoBtn')?.closest('.ps-control-row');
  const artistBox = document.getElementById('voiceArtistSelect')?.parentElement;
  if (genderRow) {
    genderRow.style.opacity = isChecked ? '0.35' : '1';
    genderRow.style.pointerEvents = isChecked ? 'none' : 'auto';
  }
  if (artistBox) {
    artistBox.style.opacity = isChecked ? '0.35' : '1';
    artistBox.style.pointerEvents = isChecked ? 'none' : 'auto';
  }
}

// TRIGGER CREATE SONG OR DIALOGUE
async function triggerCreate() {
  if (currentStudioMode === 'dialogue') {
    return generateDialogueAudio();
  }

  const isSimple = currentStudioMode === 'simple';
  const styleText = isSimple ? simpleDescInput.value.trim() : styleInput.value.trim();
  const lyricsText = !isSimple && !instrumentalToggle.checked ? lyricsInput.value.trim() : '';
  const titleText = titleInput.value.trim() || 'My PixelSquad Song';

  if (!styleText && !lyricsText) {
    alert('Please enter a Style of Music or Lyrics first!');
    return;
  }

  // Validate Cover / Repaint audio requirements
  if ((currentStudioMode === 'cover' || currentStudioMode === 'repaint') && !uploadedAudioPath) {
    alert(`Please upload an audio file first for ${currentStudioMode === 'cover' ? 'Remix / Cover' : 'Repaint'} mode!`);
    return;
  }

  // Voice Artist prompt resolution
  let artistPrompt = '';
  if (selectedVoiceArtist === 'custom') {
    artistPrompt = document.getElementById('customVoiceInput')?.value.trim() || '';
  } else if (VOICE_ARTISTS[selectedVoiceArtist]) {
    artistPrompt = VOICE_ARTISTS[selectedVoiceArtist].prompt;
  }

  // UI state: generating
  createBtn.disabled = true;
  createBtn.innerHTML = `
    <span class="loading-ring w-5 h-5"></span>
    <span>Creating Song...</span>
  `;

  generationProgressCard.classList.remove('hidden');
  progressStatusText.textContent = 'Submitting task to PixelSquad Engine...';
  progressPercentText.textContent = '10%';
  progressBarFill.style.width = '10%';

  try {
    const payload = {
      title: titleText,
      lyrics: lyricsText,
      style: styleText,
      instrumental: instrumentalToggle.checked,
      duration: durationMode === 'custom' ? (parseFloat(durationSlider.value) || 60.0) : 60.0,
      duration_mode: durationMode,
      vocal_gender: selectedVocalGender,
      voice_artist: artistPrompt,
      max_mode: maxModeEnabled,
      weirdness: weirdnessValue,
      style_influence: styleInfluenceValue,
      variety: varietyValue,
      personalize: personalizeEnabled,
      bpm: bpmInput.value ? parseInt(bpmInput.value) : null,
      key_scale: keyInput.value.trim() || null,
      custom_mode: !isSimple,
      task_type: currentStudioMode === 'cover' ? 'cover' : (currentStudioMode === 'repaint' ? 'repaint' : 'text2music'),
      reference_audio_path: uploadedAudioPath,
      src_audio_path: uploadedAudioPath,
      audio_cover_strength: parseFloat(document.getElementById('coverStrengthSlider')?.value || 0.6),
      repainting_start: parseFloat(document.getElementById('repaintStartInput')?.value || 0.0),
      repainting_end: document.getElementById('repaintEndInput')?.value ? parseFloat(document.getElementById('repaintEndInput').value) : null,
      repaint_mode: document.getElementById('repaintModeSelect')?.value || 'balanced',
      model: currentSunoModel,
      mastering_preset: document.getElementById('masteringPresetSelect')?.value || 'suno_studio',
      inference_steps: currentSunoModel === 'v6-pro' ? 8 : (currentSunoModel === 'v6-wild' ? 6 : (parseInt(document.getElementById('stepsSlider')?.value || 4))),
      guidance_scale: currentSunoModel === 'v6-wild' ? 6.5 : (currentSunoModel === 'v6-pro' ? 7.8 : parseFloat(document.getElementById('cfgSlider')?.value || 7.0)),
      shift: currentSunoModel === 'v6-wild' ? 4.5 : (varietyValue === 'high' ? 4.5 : (varietyValue === 'low' ? 2.0 : 3.0)),
      use_random_seed: document.getElementById('randomSeedToggle')?.checked ?? true,
      seed: parseInt(document.getElementById('seedInput')?.value || -1),
      audio_format: document.getElementById('audioFormatSelect')?.value || 'mp3',
      batch_size: 1
    };

    const res = await fetch('/api/generate-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const data = await res.json();
    const taskId = data.task_id;
    
    // Start status polling
    pollGenerationProgress(taskId);

  } catch (err) {
    console.error('Generation error:', err);
    alert('Generation error: ' + err.message);
    resetCreateButton();
  }
}

function pollGenerationProgress(taskId) {
  let failCount = 0;
  let totalPollSeconds = 0;
  if (activePollingInterval) clearInterval(activePollingInterval);

  // Store active task in localStorage so refresh/reload can resume tracking
  try {
    localStorage.setItem('ps_active_task_id', taskId);
  } catch (e) {}

  // Ensure progress card is visible
  if (generationProgressCard) generationProgressCard.classList.remove('hidden');
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.innerHTML = `
      <i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>
      <span>Creating Song...</span>
    `;
    lucide.createIcons();
  }

  activePollingInterval = setInterval(async () => {
    totalPollSeconds += 2;
    // Timeout safeguard: allow up to 15 minutes (900 seconds) for long 3-minute songs
    if (totalPollSeconds > 900) {
      clearInterval(activePollingInterval);
      try { localStorage.removeItem('ps_active_task_id'); } catch (e) {}
      alert('Generation timed out after 15 minutes. Please check your GPU load or retry with a shorter duration.');
      resetCreateButton();
      await refreshTracks();
      return;
    }

    try {
      const res = await fetch(`/api/track-status/${taskId}`);
      if (!res.ok) {
        failCount++;
        if (failCount > 15) {
          clearInterval(activePollingInterval);
          try { localStorage.removeItem('ps_active_task_id'); } catch (e) {}
          alert('Lost connection to server. Please verify if server is running.');
          resetCreateButton();
          await refreshTracks();
          return;
        }
      } else {
        failCount = 0;
      }
      const data = await res.json();

      if (data.status === 'success') {
        clearInterval(activePollingInterval);
        try { localStorage.removeItem('ps_active_task_id'); } catch (e) {}
        progressStatusText.textContent = 'Generation Complete!';
        progressPercentText.textContent = '100%';
        progressBarFill.style.width = '100%';

        setTimeout(async () => {
          resetCreateButton();
          await refreshTracks();
          // Auto-play the newly generated track (index 0)
          if (currentTracks.length > 0) {
            playTrackByIndex(0);
          }
        }, 1000);
      } else if (data.status === 'failed' || data.status === 'error') {
        clearInterval(activePollingInterval);
        try { localStorage.removeItem('ps_active_task_id'); } catch (e) {}
        alert('Generation failed on server: ' + (data.message || ''));
        resetCreateButton();
      } else {
        // Still processing
        const serverProgress = data.progress || 10;
        const stageText = data.stage || 'Synthesizing musical latents with DiT...';
        progressStatusText.textContent = stageText;
        progressPercentText.textContent = `${serverProgress}%`;
        progressBarFill.style.width = `${serverProgress}%`;
      }
    } catch (err) {
      failCount++;
      if (failCount > 15) {
        clearInterval(activePollingInterval);
        try { localStorage.removeItem('ps_active_task_id'); } catch (e) {}
        resetCreateButton();
      }
    }
  }, 2000);
}

function resetCreateButton() {
  try { localStorage.removeItem('ps_active_task_id'); } catch (e) {}
  createBtn.disabled = false;
  createBtn.innerHTML = `
    <i data-lucide="sparkles" class="w-5 h-5"></i>
    <span>Create Song</span>
  `;
  generationProgressCard.classList.add('hidden');
  lucide.createIcons();
}

// DELETE TRACK
async function deleteTrack(trackId) {
  if (!confirm('Are you sure you want to delete this track?')) return;
  try {
    await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
    await refreshTracks();
    if (currentTracks[activeTrackIndex] && currentTracks[activeTrackIndex].id === trackId) {
      audioPlayer.pause();
      isPlaying = false;
      updatePlayPauseIcons();
    }
  } catch (err) {
    console.error('Delete error:', err);
  }
}

// RE-MASTER TRACK WITH SUNO AUDIO ENGINE
async function remasterTrack(trackId, event) {
  if (event) event.stopPropagation();
  const btn = event ? event.currentTarget : null;
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin text-amber-400"></i>';
    lucide.createIcons();
  }

  try {
    const res = await fetch(`/api/tracks/${trackId}/master`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'suno_studio' })
    });
    if (!res.ok) throw new Error(await res.text());
    await refreshTracks();
  } catch (err) {
    console.error('Mastering error:', err);
    alert('Mastering failed: ' + err.message);
  } finally {
    if (btn) {
      btn.innerHTML = originalHtml;
      lucide.createIcons();
    }
  }
}
window.remasterTrack = remasterTrack;

// AUDIO PLAYER & PLAYBACK CONTROLS
function playTrackByIndex(index) {
  if (index < 0 || index >= currentTracks.length) return;
  
  if (activeTrackIndex === index && isPlaying) {
    togglePlayPause();
    return;
  }

  activeTrackIndex = index;
  const track = currentTracks[index];

  audioPlayer.src = track.audio_url;
  audioPlayer.play().catch(e => console.log('Autoplay policy caught:', e));
  isPlaying = true;

  // Update bottom player UI
  document.getElementById('playerTitle').textContent = track.title || 'Untitled Track';
  document.getElementById('playerSubtitle').textContent = track.caption || 'ACE-Step 1.5';
  document.getElementById('lyricsDrawerTitle').textContent = track.title || 'Song Lyrics';
  document.getElementById('lyricsDrawerContent').textContent = track.lyrics || 'No lyrics available for this instrumental track.';

  updatePlayPauseIcons();
  renderTracks();
}

function togglePlayPause() {
  if (activeTrackIndex === -1 && currentTracks.length > 0) {
    playTrackByIndex(0);
    return;
  }

  if (audioPlayer.paused) {
    audioPlayer.play();
    isPlaying = true;
  } else {
    audioPlayer.pause();
    isPlaying = false;
  }
  updatePlayPauseIcons();
  renderTracks();
}

function updatePlayPauseIcons() {
  const mainIcon = document.getElementById('mainPlayIcon');
  if (isPlaying) {
    mainIcon.setAttribute('data-lucide', 'pause');
  } else {
    mainIcon.setAttribute('data-lucide', 'play');
  }
  lucide.createIcons();
}

function playNextTrack() {
  if (currentTracks.length === 0) return;
  const nextIdx = (activeTrackIndex + 1) % currentTracks.length;
  playTrackByIndex(nextIdx);
}

function playPrevTrack() {
  if (currentTracks.length === 0) return;
  const prevIdx = (activeTrackIndex - 1 + currentTracks.length) % currentTracks.length;
  playTrackByIndex(prevIdx);
}

function toggleLoop() {
  isLooping = !isLooping;
  audioPlayer.loop = isLooping;
  document.getElementById('loopBtn').classList.toggle('text-purple-400', isLooping);
}

function setVolume(val) {
  audioPlayer.volume = parseFloat(val);
  isMuted = audioPlayer.volume === 0;
  updateVolumeIcon();
}

function toggleMute() {
  isMuted = !isMuted;
  audioPlayer.muted = isMuted;
  updateVolumeIcon();
}

function updateVolumeIcon() {
  const icon = document.getElementById('volumeIcon');
  if (isMuted || audioPlayer.volume === 0) {
    icon.setAttribute('data-lucide', 'volume-x');
  } else if (audioPlayer.volume < 0.5) {
    icon.setAttribute('data-lucide', 'volume-1');
  } else {
    icon.setAttribute('data-lucide', 'volume-2');
  }
  lucide.createIcons();
}

function seekAudio(e) {
  if (!audioPlayer.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = clickX / rect.width;
  audioPlayer.currentTime = pct * audioPlayer.duration;
}

function downloadCurrentTrack() {
  if (activeTrackIndex >= 0 && currentTracks[activeTrackIndex]) {
    const track = currentTracks[activeTrackIndex];
    const a = document.createElement('a');
    a.href = track.audio_url;
    a.download = `${track.title || 'ACE_Song'}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

// Audio Element Event Listeners
function setupAudioEvents() {
  audioPlayer.addEventListener('timeupdate', () => {
    if (!audioPlayer.duration) return;
    const cur = audioPlayer.currentTime;
    const dur = audioPlayer.duration;
    document.getElementById('playerCurrentTime').textContent = formatDuration(cur);
    document.getElementById('playerTotalDuration').textContent = formatDuration(dur);
    const pct = (cur / dur) * 100;
    document.getElementById('playerProgressBar').style.width = `${pct}%`;
  });

  audioPlayer.addEventListener('ended', () => {
    if (!isLooping) {
      playNextTrack();
    }
  });

  audioPlayer.addEventListener('play', () => {
    isPlaying = true;
    updatePlayPauseIcons();
    renderTracks();
  });

  audioPlayer.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayPauseIcons();
    renderTracks();
  });
}

// Real-Time Canvas Audio Visualizer
function initVisualizer() {
  const canvas = document.getElementById('visualizerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bars = 12;
    const barWidth = 3;
    const gap = 2;

    for (let i = 0; i < bars; i++) {
      let height = 3;
      if (isPlaying) {
        // Dynamic rhythmic simulation if WebAudio context is restricted
        height = Math.sin(Date.now() * 0.008 + i * 0.8) * 9 + 11;
      }
      ctx.fillStyle = isPlaying ? '#ec4899' : 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(i * (barWidth + gap) + 4, canvas.height - height, barWidth, height);
    }
  }
  draw();
}

// Lyrics Drawer Modal
function toggleLyricsDrawer() {
  const drawer = document.getElementById('lyricsDrawer');
  drawer.classList.toggle('closed');
  drawer.classList.toggle('open');
}

function openLyricsForTrack(idx) {
  const track = currentTracks[idx];
  if (!track) return;
  document.getElementById('lyricsDrawerTitle').textContent = track.title || 'Song Lyrics';
  document.getElementById('lyricsDrawerSubtitle').textContent = track.caption || 'ACE-Step 1.5';
  document.getElementById('lyricsDrawerContent').textContent = track.lyrics || 'No lyrics available for this track.';
  
  const drawer = document.getElementById('lyricsDrawer');
  drawer.classList.remove('closed');
  drawer.classList.add('open');
}

// Search & Filter setup
function setupSearch() {
  searchInput.addEventListener('input', () => {
    renderTracks();
  });
}

function updateFilterButtonsUI(filterType) {
  document.querySelectorAll('.feed-filter-btn').forEach(btn => {
    if (btn.getAttribute('data-filter') === filterType) {
      btn.className = 'feed-filter-btn px-2.5 py-1 rounded-md bg-white/10 text-white font-semibold';
    } else {
      btn.className = 'feed-filter-btn px-2.5 py-1 rounded-md text-slate-400 hover:text-white';
    }
  });
}

function setFilter(filterType) {
  currentFilter = filterType;
  updateFilterButtonsUI(filterType);
  renderTracks();
}

// ========================================================
// AUTHENTIC SUNO SIDEBAR NAVIGATION HANDLERS (@image1)
// ========================================================
let isSidebarCollapsed = false;

function toggleSidebar() {
  isSidebarCollapsed = !isSidebarCollapsed;
  const sidebar = document.getElementById('sunoSidebar');
  const labels = document.querySelectorAll('.nav-label');
  const userText = document.getElementById('sidebarUserText');
  const proBtnText = document.getElementById('sidebarProBtnText');
  const logoText = document.getElementById('sidebarLogoText');
  const toggleIcon = document.getElementById('sidebarToggleIcon');

  if (isSidebarCollapsed) {
    sidebar.classList.remove('w-60');
    sidebar.classList.add('w-[72px]', 'p-2');
    labels.forEach(l => l.classList.add('hidden'));
    if (userText) userText.classList.add('hidden');
    if (proBtnText) proBtnText.classList.add('hidden');
    if (logoText) logoText.classList.add('hidden');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-left-open');
  } else {
    sidebar.classList.remove('w-[72px]', 'p-2');
    sidebar.classList.add('w-60');
    labels.forEach(l => l.classList.remove('hidden'));
    if (userText) userText.classList.remove('hidden');
    if (proBtnText) proBtnText.classList.remove('hidden');
    if (logoText) logoText.classList.remove('hidden');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'columns-2');
  }
  lucide.createIcons();
}

function switchNavTab(tab) {
  currentNavTab = tab;
  const navMap = {
    'home': 'navHomeBtn',
    'create': 'navCreateBtn',
    'dialogue': 'navDialogueBtn',
    'cloner': 'navCloneBtn',
    'studio': 'navStudioBtn',
    'explore': 'navExploreBtn',
    'labs': 'navDialogueBtn'
  };

  Object.values(navMap).forEach(btnId => {
    const el = document.getElementById(btnId);
    if (el) el.classList.remove('active');
  });

  const activeBtn = document.getElementById(navMap[tab]);
  if (activeBtn) activeBtn.classList.add('active');

  const headerSectionLabel = document.getElementById('headerActiveSection');
  const feedHeaderTitle = document.getElementById('feedHeaderTitle');
  const createDrawer = document.getElementById('createDrawer');

  if (tab === 'home') {
    if (headerSectionLabel) headerSectionLabel.textContent = 'Home Studio Feed';
    if (feedHeaderTitle) feedHeaderTitle.textContent = 'Recent Creations';
    searchInput.value = '';
    renderTracks();
    setStudioMode('custom');
    if (createDrawer) createDrawer.scrollTop = 0;
  } else if (tab === 'create') {
    if (headerSectionLabel) headerSectionLabel.textContent = 'Music Generator • Create Song & Audio';
    if (feedHeaderTitle) feedHeaderTitle.textContent = 'Recent Music Creations';
    setStudioMode('custom');
    if (createDrawer) {
      createDrawer.scrollTop = 0;
      const lyricsIn = document.getElementById('lyricsInput');
      if (lyricsIn) lyricsIn.focus();
    }
  } else if (tab === 'dialogue' || tab === 'labs') {
    if (headerSectionLabel) headerSectionLabel.textContent = 'Dialogue & Speech Lab (TTS)';
    if (feedHeaderTitle) feedHeaderTitle.textContent = 'Dialogue & Speech Creations';
    setStudioMode('dialogue');
    currentFilter = 'dialogue';
    updateFilterButtonsUI('dialogue');
    renderTracks();
    if (createDrawer) {
      createDrawer.scrollTop = 0;
      const diaInput = document.getElementById('dialogueScriptInput');
      if (diaInput) diaInput.focus();
    }
  } else if (tab === 'cloner') {
    if (headerSectionLabel) headerSectionLabel.textContent = 'AI Voice Cloner & Timbre Studio';
    if (feedHeaderTitle) feedHeaderTitle.textContent = 'Custom Voice Library';
    setStudioMode('cloner');
    if (createDrawer) {
      createDrawer.scrollTop = 0;
      const nameIn = document.getElementById('drawerVoiceNameInput');
      if (nameIn) nameIn.focus();
    }
  } else if (tab === 'studio') {
    if (headerSectionLabel) headerSectionLabel.textContent = 'Audio Studio • Advanced Tuning & Engine';
    setStudioMode('custom');
    const details = document.querySelectorAll('#createDrawer details');
    details.forEach(d => d.open = true);
    if (createDrawer) createDrawer.scrollTop = 250;
  } else if (tab === 'explore' || tab === 'library') {
    if (headerSectionLabel) headerSectionLabel.textContent = 'Explore Music History & Past Creations';
    if (feedHeaderTitle) feedHeaderTitle.textContent = 'Explore History (Past Musics)';
    currentFilter = 'all';
    updateFilterButtonsUI('all');
    searchInput.value = '';
    renderTracks();
    const container = document.getElementById('tracksContainer');
    if (container) container.scrollTop = 0;
  }
  lucide.createIcons();
}

function showUserProfileModal() {
  alert('👤 PixelSquad Studio Account:\n• User: Shahid (Admin)\n• Engine: ACE-Step 1.5 Local DiT Turbo\n• GPU: NVIDIA GeForce RTX 3060 Laptop (6GB VRAM)\n• Mode: Unlimited Private Generation (0 Cost)');
}

function showCreditsInfo() {
  alert('🎁 Free & Unlimited Local Credits:\n• You are running 100% locally on your NVIDIA RTX 3060 GPU.\n• No subscription or token limits.\n• Generate unlimited songs, raps, covers, and dialogue speech completely free!');
}

function showNotifications() {
  alert('🔔 System Notifications:\n• ACE-Step 1.5 DiT Turbo: Online & Ready\n• Neural Dialogue Engine (TTS): Active (10 Voices)\n• Storage: Saved in H:\\Music Creator\\gradio_outputs');
}

function toggleMoreMenu() {
  toggleTheme();
}

function showProModal() {
  alert('✨ PixelSquad Studio Pro:\n• All Pro Features Active: DiT Turbo, INT8 Quantization, Flash Attention 2, Zero-Shot Voice Lab, and Full High-Quality Export.');
}

// Helpers
function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========================================================
// PIXELSQUAD DIALOGUE & VOICE LAB ENGINE
// ========================================================
let availableSystemVoices = [];
let availableCustomVoices = [];
let selectedDialogueVoice = 'hi-IN-MadhurNeural';
let dialogueSpeed = 1.0;
let dialoguePitch = 0;
let clonedAudioFilePath = null;

async function loadAvailableVoices() {
  try {
    const res = await fetch('/api/voices/list');
    const data = await res.json();
    if (data.success) {
      availableSystemVoices = data.system_voices || [];
      availableCustomVoices = data.custom_voices || [];
      populateDialogueVoiceSelect();
    }
  } catch (err) {
    console.error('Failed to load voices:', err);
  }
}

function populateDialogueVoiceSelect() {
  const sel = document.getElementById('dialogueVoiceSelect');
  if (!sel) return;

  let html = '';
  // Custom voices first if any
  if (availableCustomVoices.length > 0) {
    html += '<optgroup label="🌟 My Saved & Cloned Voices">';
    availableCustomVoices.forEach(v => {
      html += `<option value="${v.id}">${v.name} (${v.gender.toUpperCase()} • ${v.base_voice.split('-')[0]})</option>`;
    });
    html += '</optgroup>';
  }

  // System voices
  html += '<optgroup label="🇮🇳 Hindi Neural Voices">';
  availableSystemVoices.filter(v => v.category === 'hindi').forEach(v => {
    html += `<option value="${v.id}">${v.name}</option>`;
  });
  html += '</optgroup>';

  html += '<optgroup label="🇮🇳 Indian English Neural Voices">';
  availableSystemVoices.filter(v => v.category === 'indian_english').forEach(v => {
    html += `<option value="${v.id}">${v.name}</option>`;
  });
  html += '</optgroup>';

  html += '<optgroup label="🎙️ Narrator & US Voices">';
  availableSystemVoices.filter(v => v.category === 'narrator' || v.category === 'us_english' || v.category === 'expressive').forEach(v => {
    html += `<option value="${v.id}">${v.name}</option>`;
  });
  html += '</optgroup>';

  html += '<optgroup label="🇬🇧 British Voices">';
  availableSystemVoices.filter(v => v.category === 'uk_english').forEach(v => {
    html += `<option value="${v.id}">${v.name}</option>`;
  });
  html += '</optgroup>';

  sel.innerHTML = html;
  if (selectedDialogueVoice) {
    sel.value = selectedDialogueVoice;
  }
  handleDialogueVoiceChange(sel.value);
}

function handleDialogueVoiceChange(voiceId) {
  selectedDialogueVoice = voiceId;
  const badge = document.getElementById('activeDialogueVoiceBadge');
  const allVoices = [...availableSystemVoices, ...availableCustomVoices];
  const found = allVoices.find(v => v.id === voiceId);
  if (badge && found) {
    badge.textContent = found.badge || found.name.split('-')[0];
  }
}

async function auditionCurrentVoice() {
  const btn = document.getElementById('auditionVoiceBtn');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="loading-ring w-3 h-3"></span> Playing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/tts/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice: selectedDialogueVoice,
        text: 'Namaste! Yeh PixelSquad Studio ki neural voice preview hai.',
        rate: dialogueSpeed !== 1.0 ? `${Math.round((dialogueSpeed - 1.0) * 100)}%` : '+0%',
        pitch: dialoguePitch !== 0 ? `${dialoguePitch}Hz` : '+0Hz'
      })
    });
    const data = await res.json();
    if (data.success && data.audio_url) {
      const audio = new Audio(data.audio_url);
      audio.play();
    }
  } catch (err) {
    console.error('Audition error:', err);
  } finally {
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }, 1500);
  }
}

function updateDialogueCharCount() {
  const input = document.getElementById('dialogueScriptInput');
  const el = document.getElementById('dialogueCharCount');
  if (input && el) {
    el.textContent = `${input.value.length} chars`;
  }
}

function insertDialogueEmotion(tag) {
  const input = document.getElementById('dialogueScriptInput');
  if (!input) return;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const text = input.value;
  input.value = text.substring(0, start) + tag + text.substring(end);
  input.focus();
  input.selectionStart = input.selectionEnd = start + tag.length;
  updateDialogueCharCount();
}

function loadDialogueTemplate(type) {
  const input = document.getElementById('dialogueScriptInput');
  const titleInput = document.getElementById('dialogueTitleInput');
  if (!input) return;

  if (type === 'rap_dialogue') {
    input.value = '[Aggressive] पीठ दिखाकर गए थे, अब सामने क्यों आए? जब डूब रहा था मैं, तुम हाथ क्यों ना बढ़ाए? याद रखना... अब मेरी बारी है!';
    if (titleInput) titleInput.value = 'Desi Rap Aggressive Monologue';
  } else if (type === 'movie_monologue') {
    input.value = '[Dramatic] कल तक था पैसा, कल तक था नाम! चारों तरफ थे चेहरे हज़ार... लेकिन जब जेब हुई खाली, तो रिश्ते हुए बंद!';
    if (titleInput) titleInput.value = 'Dramatic Movie Monologue';
  } else if (type === 'trailer_narrator') {
    input.value = '[Narrator] In a world ruled by silence, one voice dared to challenge the empire. This winter, witness the rise of PixelSquad.';
    if (titleInput) titleInput.value = 'Epic Movie Trailer Voiceover';
    const sel = document.getElementById('dialogueVoiceSelect');
    if (sel && sel.querySelector('option[value="en-US-ChristopherNeural"]')) {
      sel.value = 'en-US-ChristopherNeural';
      handleDialogueVoiceChange(sel.value);
    }
  } else if (type === 'podcast_host') {
    input.value = '[Heroic] Welcome back to PixelSquad Stories! Aaj ke episode me hum un baaton par roshni dalenge jo aksar parde ke peeche reh jaati hain.';
    if (titleInput) titleInput.value = 'Podcast Host Introduction';
  }
  updateDialogueCharCount();
}

function updateDialogueSpeed(val) {
  dialogueSpeed = parseFloat(val);
  const el = document.getElementById('dialogueSpeedVal');
  if (el) el.textContent = `${dialogueSpeed.toFixed(2)}x`;
}

function updateDialoguePitch(val) {
  dialoguePitch = parseInt(val);
  const el = document.getElementById('dialoguePitchVal');
  if (el) {
    if (dialoguePitch === 0) el.textContent = '0 Hz (Normal)';
    else if (dialoguePitch > 0) el.textContent = `+${dialoguePitch} Hz (Bright)`;
    else el.textContent = `${dialoguePitch} Hz (Deep Baritone)`;
  }
}

// Modal Voice Profile Mic Recording State
let modalMediaRecorder = null;
let modalAudioChunks = [];
let modalRecInterval = null;
let modalRecSeconds = 0;
let modalAudioStream = null;

function openCreateVoiceModal(startMicImmediately = false) {
  const modal = document.getElementById('createVoiceModal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();

  if (startMicImmediately) {
    setTimeout(() => {
      startModalMicRecording();
    }, 250);
  }
}

function closeCreateVoiceModal() {
  cancelModalMicRecording();
  discardClonedAudio();
  const modal = document.getElementById('createVoiceModal');
  if (modal) modal.classList.add('hidden');
}

function toggleModalMicRecording() {
  if (modalMediaRecorder && modalMediaRecorder.state === 'recording') {
    stopModalMicRecording();
  } else {
    startModalMicRecording();
  }
}

async function startModalMicRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Microphone access is not supported by your browser or requires HTTPS / localhost.');
      return;
    }

    modalAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
      mimeType = 'audio/ogg';
    }

    modalAudioChunks = [];
    modalMediaRecorder = new MediaRecorder(modalAudioStream, { mimeType });

    modalMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        modalAudioChunks.push(e.data);
      }
    };

    modalMediaRecorder.onstop = async () => {
      if (modalRecInterval) {
        clearInterval(modalRecInterval);
        modalRecInterval = null;
      }

      if (modalAudioStream) {
        modalAudioStream.getTracks().forEach(t => t.stop());
        modalAudioStream = null;
      }

      const recBox = document.getElementById('modalRecordingBox');
      const btnText = document.getElementById('modalMicBtnText');
      if (recBox) recBox.classList.add('hidden');
      if (btnText) btnText.textContent = 'Record Voice';

      if (modalAudioChunks.length === 0) return;

      const audioBlob = new Blob(modalAudioChunks, { type: mimeType });
      const ext = mimeType.includes('mp4') ? 'mp4' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
      const recordedFile = new File([audioBlob], `voice_profile_sample_${Date.now()}.${ext}`, { type: mimeType });

      // Local preview player
      const audioUrl = URL.createObjectURL(audioBlob);
      const player = document.getElementById('modalAudioPlayer');
      const previewBox = document.getElementById('modalAudioPreviewBox');
      if (player) player.src = audioUrl;
      if (previewBox) previewBox.classList.remove('hidden');

      const fnEl = document.getElementById('clonedVoiceFilename');
      if (fnEl) fnEl.textContent = 'Saving sample...';

      const formData = new FormData();
      formData.append('file', recordedFile);

      try {
        const res = await fetch('/api/upload-audio', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          clonedAudioFilePath = data.file_path;
          if (fnEl) fnEl.textContent = `✓ Mic Sample (${modalRecSeconds}s)`;
        } else {
          if (fnEl) fnEl.textContent = 'Upload failed';
        }
      } catch (err) {
        console.error('Mic sample upload failed:', err);
        if (fnEl) fnEl.textContent = 'Upload failed';
      }
    };

    modalMediaRecorder.start(250);
    modalRecSeconds = 0;

    const recBox = document.getElementById('modalRecordingBox');
    const previewBox = document.getElementById('modalAudioPreviewBox');
    const timerEl = document.getElementById('modalRecTimer');
    const btnText = document.getElementById('modalMicBtnText');

    if (recBox) recBox.classList.remove('hidden');
    if (previewBox) previewBox.classList.add('hidden');
    if (btnText) btnText.textContent = 'Stop Recording';
    if (timerEl) timerEl.textContent = '00:00 / 00:15';

    modalRecInterval = setInterval(() => {
      modalRecSeconds++;
      const secs = modalRecSeconds % 60;
      const mins = Math.floor(modalRecSeconds / 60);
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (timerEl) timerEl.textContent = `${formatted} / 00:15`;

      if (modalRecSeconds >= 15) {
        stopModalMicRecording();
      }
    }, 1000);

  } catch (err) {
    console.error('Microphone error:', err);
    alert('Microphone access denied or error: ' + (err.message || 'Please check mic permissions in browser settings.'));
    cancelModalMicRecording();
  }
}

function stopModalMicRecording() {
  if (modalMediaRecorder && modalMediaRecorder.state !== 'inactive') {
    modalMediaRecorder.stop();
  }
}

function cancelModalMicRecording() {
  if (modalMediaRecorder && modalMediaRecorder.state !== 'inactive') {
    modalAudioChunks = [];
    modalMediaRecorder.stop();
  }
  if (modalRecInterval) {
    clearInterval(modalRecInterval);
    modalRecInterval = null;
  }
  if (modalAudioStream) {
    modalAudioStream.getTracks().forEach(t => t.stop());
    modalAudioStream = null;
  }
  const recBox = document.getElementById('modalRecordingBox');
  const btnText = document.getElementById('modalMicBtnText');
  if (recBox) recBox.classList.add('hidden');
  if (btnText) btnText.textContent = 'Record Voice';
}

function discardClonedAudio() {
  clonedAudioFilePath = null;
  const fnEl = document.getElementById('clonedVoiceFilename');
  const previewBox = document.getElementById('modalAudioPreviewBox');
  const player = document.getElementById('modalAudioPlayer');
  const fileInput = document.getElementById('clonedVoiceFileInput');
  const btnText = document.getElementById('modalMicBtnText');

  if (fnEl) fnEl.textContent = '';
  if (previewBox) previewBox.classList.add('hidden');
  if (player) {
    player.pause();
    player.src = '';
  }
  if (fileInput) fileInput.value = '';
  if (btnText) btnText.textContent = 'Record Voice';
}

async function handleClonedAudioUpload(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) return;

  const fnEl = document.getElementById('clonedVoiceFilename');
  const previewBox = document.getElementById('modalAudioPreviewBox');
  const player = document.getElementById('modalAudioPlayer');

  if (fnEl) fnEl.textContent = 'Uploading...';

  // Preview local file in player immediately
  const localUrl = URL.createObjectURL(file);
  if (player) player.src = localUrl;
  if (previewBox) previewBox.classList.remove('hidden');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload-audio', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      clonedAudioFilePath = data.file_path;
      if (fnEl) fnEl.textContent = `✓ ${file.name}`;
    } else {
      if (fnEl) fnEl.textContent = 'Upload failed';
    }
  } catch (err) {
    if (fnEl) fnEl.textContent = 'Upload failed';
  }
}

async function saveNewCustomVoice() {
  const nameInput = document.getElementById('newVoiceNameInput');
  const genderSel = document.getElementById('newVoiceGenderSelect');
  const baseSel = document.getElementById('newVoiceBaseSelect');
  const pitchSel = document.getElementById('newVoicePitchSelect');
  const rateSel = document.getElementById('newVoiceRateSelect');

  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert('Please enter a voice character name!');
    return;
  }

  const payload = {
    name: name,
    gender: genderSel ? genderSel.value : 'male',
    base_voice: baseSel ? baseSel.value : 'hi-IN-MadhurNeural',
    pitch: pitchSel ? pitchSel.value : '+0Hz',
    rate: rateSel ? rateSel.value : '+0%',
    reference_audio_path: clonedAudioFilePath,
    description: `Custom voice based on ${baseSel ? baseSel.value : 'neural voice'}`
  };

  try {
    const res = await fetch('/api/voices/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeCreateVoiceModal();
      await loadAvailableVoices();
      selectedDialogueVoice = data.voice.id;
      const sel = document.getElementById('dialogueVoiceSelect');
      if (sel) {
        sel.value = data.voice.id;
        handleDialogueVoiceChange(data.voice.id);
      }
      alert(`Voice "${name}" saved to Voice Library successfully!`);
    }
  } catch (err) {
    alert('Failed to save custom voice.');
  }
}

// ==========================================
// DRAWER VOICE CLONER LOGIC & HANDLERS
// ==========================================
let drawerClonedAudioFilePath = null;
let drawerClonerMediaRecorder = null;
let drawerClonerAudioChunks = [];
let drawerClonerRecInterval = null;
let drawerClonerRecSeconds = 0;
let drawerClonerAudioStream = null;

async function toggleDrawerClonerMic() {
  if (drawerClonerMediaRecorder && drawerClonerMediaRecorder.state === 'recording') {
    stopDrawerClonerMic();
    return;
  }

  try {
    drawerClonerAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    drawerClonerAudioChunks = [];
    drawerClonerMediaRecorder = new MediaRecorder(drawerClonerAudioStream);

    drawerClonerMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        drawerClonerAudioChunks.push(e.data);
      }
    };

    drawerClonerMediaRecorder.onstop = async () => {
      if (drawerClonerRecInterval) {
        clearInterval(drawerClonerRecInterval);
        drawerClonerRecInterval = null;
      }
      if (drawerClonerAudioStream) {
        drawerClonerAudioStream.getTracks().forEach(t => t.stop());
        drawerClonerAudioStream = null;
      }

      const recBox = document.getElementById('drawerClonerRecBox');
      const btnText = document.getElementById('drawerClonerMicBtnText');
      if (recBox) recBox.classList.add('hidden');
      if (btnText) btnText.textContent = 'Record Voice';

      if (drawerClonerAudioChunks.length === 0) return;

      const audioBlob = new Blob(drawerClonerAudioChunks, { type: 'audio/webm' });
      const player = document.getElementById('drawerClonerAudioPlayer');
      const previewBox = document.getElementById('drawerClonerPreviewBox');
      const fnEl = document.getElementById('drawerClonerFilename');

      if (player) player.src = URL.createObjectURL(audioBlob);
      if (previewBox) previewBox.classList.remove('hidden');
      if (fnEl) fnEl.textContent = 'Uploading mic recording...';

      const formData = new FormData();
      formData.append('file', audioBlob, `voice_clone_sample_${Date.now()}.webm`);

      try {
        const res = await fetch('/api/upload-audio', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          drawerClonedAudioFilePath = data.file_path;
          clonedAudioFilePath = data.file_path;
          if (fnEl) fnEl.textContent = `✓ Mic Sample Recorded (${drawerClonerRecSeconds}s)`;
        } else {
          if (fnEl) fnEl.textContent = 'Upload failed';
        }
      } catch (err) {
        if (fnEl) fnEl.textContent = 'Upload failed';
      }
    };

    drawerClonerMediaRecorder.start(250);
    drawerClonerRecSeconds = 0;

    const recBox = document.getElementById('drawerClonerRecBox');
    const previewBox = document.getElementById('drawerClonerPreviewBox');
    const timerEl = document.getElementById('drawerClonerRecTimer');
    const btnText = document.getElementById('drawerClonerMicBtnText');

    if (recBox) recBox.classList.remove('hidden');
    if (previewBox) previewBox.classList.add('hidden');
    if (btnText) btnText.textContent = 'Stop Recording';
    if (timerEl) timerEl.textContent = '00:00 / 00:15';

    drawerClonerRecInterval = setInterval(() => {
      drawerClonerRecSeconds++;
      const secs = drawerClonerRecSeconds % 60;
      const mins = Math.floor(drawerClonerRecSeconds / 60);
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (timerEl) timerEl.textContent = `${formatted} / 00:15`;

      if (drawerClonerRecSeconds >= 15) {
        stopDrawerClonerMic();
      }
    }, 1000);

  } catch (err) {
    alert('Microphone access error: ' + (err.message || 'Please check mic permissions in browser settings.'));
    cancelDrawerClonerMic();
  }
}

function stopDrawerClonerMic() {
  if (drawerClonerMediaRecorder && drawerClonerMediaRecorder.state !== 'inactive') {
    drawerClonerMediaRecorder.stop();
  }
}

function cancelDrawerClonerMic() {
  if (drawerClonerMediaRecorder && drawerClonerMediaRecorder.state !== 'inactive') {
    drawerClonerAudioChunks = [];
    drawerClonerMediaRecorder.stop();
  }
  if (drawerClonerRecInterval) {
    clearInterval(drawerClonerRecInterval);
    drawerClonerRecInterval = null;
  }
  if (drawerClonerAudioStream) {
    drawerClonerAudioStream.getTracks().forEach(t => t.stop());
    drawerClonerAudioStream = null;
  }
  const recBox = document.getElementById('drawerClonerRecBox');
  const btnText = document.getElementById('drawerClonerMicBtnText');
  if (recBox) recBox.classList.add('hidden');
  if (btnText) btnText.textContent = 'Record Voice';
}

function discardDrawerClonerAudio() {
  drawerClonedAudioFilePath = null;
  const fnEl = document.getElementById('drawerClonerFilename');
  const previewBox = document.getElementById('drawerClonerPreviewBox');
  const player = document.getElementById('drawerClonerAudioPlayer');
  const fileInput = document.getElementById('drawerClonerFileInput');
  const btnText = document.getElementById('drawerClonerMicBtnText');

  if (fnEl) fnEl.textContent = '';
  if (previewBox) previewBox.classList.add('hidden');
  if (player) {
    player.pause();
    player.src = '';
  }
  if (fileInput) fileInput.value = '';
  if (btnText) btnText.textContent = 'Record Voice';
}

async function handleDrawerClonerUpload(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) return;

  const fnEl = document.getElementById('drawerClonerFilename');
  const previewBox = document.getElementById('drawerClonerPreviewBox');
  const player = document.getElementById('drawerClonerAudioPlayer');

  if (fnEl) fnEl.textContent = 'Uploading...';

  const localUrl = URL.createObjectURL(file);
  if (player) player.src = localUrl;
  if (previewBox) previewBox.classList.remove('hidden');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload-audio', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      drawerClonedAudioFilePath = data.file_path;
      clonedAudioFilePath = data.file_path;
      if (fnEl) fnEl.textContent = `✓ ${file.name}`;
    } else {
      if (fnEl) fnEl.textContent = 'Upload failed';
    }
  } catch (err) {
    if (fnEl) fnEl.textContent = 'Upload failed';
  }
}

async function saveDrawerCustomVoice() {
  const nameInput = document.getElementById('drawerVoiceNameInput');
  const genderSel = document.getElementById('drawerVoiceGenderSelect');
  const baseSel = document.getElementById('drawerVoiceBaseSelect');
  const pitchSel = document.getElementById('drawerVoicePitchSelect');
  const rateSel = document.getElementById('drawerVoiceRateSelect');

  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert('Please enter a voice character name!');
    if (nameInput) nameInput.focus();
    return;
  }

  const audioPath = drawerClonedAudioFilePath || clonedAudioFilePath;

  const payload = {
    name: name,
    gender: genderSel ? genderSel.value : 'male',
    base_voice: baseSel ? baseSel.value : 'hi-IN-MadhurNeural',
    pitch: pitchSel ? pitchSel.value : '+0Hz',
    rate: rateSel ? rateSel.value : '+0%',
    reference_audio_path: audioPath,
    description: `Custom cloned voice based on ${baseSel ? baseSel.value : 'neural voice'}`
  };

  try {
    const res = await fetch('/api/voices/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      await loadAvailableVoices();
      selectedDialogueVoice = data.voice.id;
      const sel = document.getElementById('dialogueVoiceSelect');
      if (sel) {
        sel.value = data.voice.id;
        handleDialogueVoiceChange(data.voice.id);
      }
      alert(`Voice "${name}" saved to Custom Voices successfully!\nIt is now active in Dialogue Lab.`);
      switchNavTab('dialogue');
    } else {
      alert(`Error saving custom voice: ${data.detail || 'Failed'}`);
    }
  } catch (err) {
    alert('Failed to save custom voice.');
  }
}

async function generateDialogueAudio() {
  const scriptInput = document.getElementById('dialogueScriptInput');
  const titleInput = document.getElementById('dialogueTitleInput');
  const text = scriptInput ? scriptInput.value.trim() : '';
  const title = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : 'Dialogue Audio';

  if (!text) {
    alert('Please write some dialogue or script first!');
    return;
  }

  const createBtn = document.getElementById('createBtn');
  const progressCard = document.getElementById('generationProgressCard');
  const statusText = document.getElementById('progressStatusText');
  const percentText = document.getElementById('progressPercentText');
  const fill = document.getElementById('progressBarFill');

  createBtn.disabled = true;
  createBtn.classList.add('opacity-50', 'cursor-not-allowed');
  progressCard.classList.remove('hidden');
  statusText.textContent = 'Synthesizing neural dialogue audio...';
  percentText.textContent = '45%';
  fill.style.width = '45%';

  try {
    const speedPct = Math.round((dialogueSpeed - 1.0) * 100);
    const rateStr = speedPct >= 0 ? `+${speedPct}%` : `${speedPct}%`;
    const pitchStr = dialoguePitch >= 0 ? `+${dialoguePitch}Hz` : `${dialoguePitch}Hz`;

    const res = await fetch('/api/tts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        title: title,
        voice: selectedDialogueVoice,
        rate: rateStr,
        pitch: pitchStr
      })
    });
    const data = await res.json();
    if (data.success && data.track) {
      percentText.textContent = '100%';
      fill.style.width = '100%';
      statusText.textContent = 'Dialogue generated successfully!';

      // Prepend to tracks
      currentTracks.unshift(data.track);
      renderTracks();
      updateLibraryBadges();

      // Immediately play in bottom audio player
      playTrackByIndex(0);

      setTimeout(() => {
        progressCard.classList.add('hidden');
        createBtn.disabled = false;
        createBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }, 1000);
    } else {
      throw new Error(data.detail || 'Generation failed');
    }
  } catch (err) {
    alert(`Dialogue generation error: ${err.message}`);
    progressCard.classList.add('hidden');
    createBtn.disabled = false;
    createBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

// ==========================================
// BATCH / BULK MULTIPLE VOICES IMPORT
// ==========================================
let selectedBatchFiles = [];

function handleBatchVoiceSelection(event) {
  const files = event.target.files ? Array.from(event.target.files) : [];
  if (files.length === 0) return;

  selectedBatchFiles = files;
  const countEl = document.getElementById('batchSelectedCount');
  const boxEl = document.getElementById('batchSelectedBox');
  const listEl = document.getElementById('batchFilesPreviewList');

  if (countEl) countEl.textContent = `${files.length} audio files selected (ready to auto-register)`;
  if (boxEl) boxEl.classList.remove('hidden');

  if (listEl) {
    listEl.innerHTML = '';
    files.forEach(f => {
      const cleanName = f.name.replace(/\.[^/.]+$/, '').replace(/[_\-]+/g, ' ').trim();
      const pill = document.createElement('span');
      pill.className = 'text-[10px] px-2 py-1 rounded-lg bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 font-medium flex items-center gap-1';
      pill.innerHTML = `<span>🎙️ ${escapeHtml(cleanName)}</span>`;
      listEl.appendChild(pill);
    });
  }
}

function clearBatchSelectedFiles() {
  selectedBatchFiles = [];
  const boxEl = document.getElementById('batchSelectedBox');
  const listEl = document.getElementById('batchFilesPreviewList');
  const inputEl = document.getElementById('batchVoiceInput');
  if (boxEl) boxEl.classList.add('hidden');
  if (listEl) listEl.innerHTML = '';
  if (inputEl) inputEl.value = '';
}

async function uploadAndRegisterBatchVoices() {
  if (selectedBatchFiles.length === 0) {
    alert('Please select some audio files first!');
    return;
  }

  const btn = document.getElementById('batchImportBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Importing ${selectedBatchFiles.length} Voices...`;
  }

  const formData = new FormData();
  selectedBatchFiles.forEach(f => {
    formData.append('files', f);
  });

  try {
    const res = await fetch('/api/voices/batch-import', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      clearBatchSelectedFiles();
      await loadAvailableVoices();
      alert(`🎉 Successfully registered ${data.count} new voices!\nEach voice has been named automatically after its audio file and is now ready in Dialogue Lab.`);
      switchNavTab('dialogue');
    } else {
      alert(`Import failed: ${data.detail || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Batch import error:', err);
    alert('Failed to upload and register batch voices: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="upload-cloud" class="w-4 h-4"></i><span>Import & Register All Voices</span>';
      lucide.createIcons();
    }
  }
}
