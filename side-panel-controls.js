// ========== SIDE PANEL TOGGLE & RESIZE ==========
const sidePanel = document.getElementById('side-panel');
const sidePanelToggle = document.getElementById('side-panel-toggle');
const resizeHandle = document.getElementById('resize-handle');
const toggleMergePanelBtn = document.getElementById('toggle-merge-panel-btn');
const mainContent = document.getElementById('main-content');

// Side panel state
let isPanelCollapsed = false;
let isResizing = false;

// Toggle side panel
function toggleSidePanel() {
  isPanelCollapsed = !isPanelCollapsed;
  
  if (isPanelCollapsed) {
    sidePanel.classList.add('collapsed');
    mainContent.classList.add('full-width');
    mainContent.classList.remove('with-panel');
    if (toggleMergePanelBtn) toggleMergePanelBtn.textContent = 'Merge ▸';
  } else {
    sidePanel.classList.remove('collapsed');
    mainContent.classList.add('with-panel');
    mainContent.classList.remove('full-width');
    if (toggleMergePanelBtn) toggleMergePanelBtn.textContent = 'Merge ◂';
  }
  
  localStorage.setItem('merge-panel-collapsed', isPanelCollapsed.toString());
  console.log('[SidePanel] Toggled, collapsed:', isPanelCollapsed);
}

// Event listeners for toggle buttons
sidePanelToggle?.addEventListener('click', toggleSidePanel);
toggleMergePanelBtn?.addEventListener('click', toggleSidePanel);

// Transparent overlay that blocks webview mouse capture during resize
const resizeOverlay = document.getElementById('resize-overlay');

function forceHideResizeOverlay() {
  if (!resizeOverlay) return;
  resizeOverlay.style.display = 'none';
}

function startResize() {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  if (sidePanel) sidePanel.style.transition = 'none';
  // Show overlay over webviews so they don't swallow mouse events
  if (resizeOverlay) resizeOverlay.style.display = 'block';
}

function stopResize() {
  if (!isResizing) return;
  isResizing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  if (sidePanel) sidePanel.style.transition = '';
  forceHideResizeOverlay();
  if (sidePanel) {
    localStorage.setItem('merge-panel-width', sidePanel.style.width);
  }
}

function doResize(clientX) {
  const sidePanelWrapper = document.getElementById('side-panel-wrapper');
  const wrapperRight = sidePanelWrapper
    ? sidePanelWrapper.getBoundingClientRect().right
    : window.innerWidth;

  const newWidth = wrapperRight - clientX;
  const minWidth = 300;
  const maxWidth = Math.floor(window.innerWidth * 0.45);

  const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
  sidePanel.style.width = clampedWidth + 'px';
  mainContent.style.width = '';
  mainContent.style.flex = '1 1 0';
}

// Resize handle functionality
resizeHandle?.addEventListener('mousedown', (e) => {
  startResize();
  e.preventDefault();
  e.stopPropagation();
});

// Also attach move/up to the overlay so events never get lost
resizeOverlay?.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  doResize(e.clientX);
});

resizeOverlay?.addEventListener('mouseup', stopResize);
resizeOverlay?.addEventListener('mouseleave', stopResize);
resizeOverlay?.addEventListener('mousedown', (e) => {
  if (!isResizing) {
    forceHideResizeOverlay();
    return;
  }
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  doResize(e.clientX);
});

window.addEventListener('mouseup', stopResize);
window.addEventListener('blur', stopResize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopResize();
});

forceHideResizeOverlay();

// Restore panel state from localStorage
const savedCollapsed = localStorage.getItem('merge-panel-collapsed');
if (savedCollapsed === 'true') {
  isPanelCollapsed = true;
  sidePanel?.classList.add('collapsed');
  mainContent?.classList.add('full-width');
  if (toggleMergePanelBtn) toggleMergePanelBtn.textContent = 'Merge ▸';
} else {
  mainContent?.classList.add('with-panel');
  mainContent.style.flex = '1 1 0';
  // Restore saved width (clamped to current screen)
  const savedWidth = localStorage.getItem('merge-panel-width');
  if (savedWidth && sidePanel) {
    const w = parseInt(savedWidth);
    const maxWidth = Math.floor(window.innerWidth / 3);
    if (w >= 300 && w <= maxWidth) {
      sidePanel.style.width = w + 'px';
    }
  }
}

console.log('[SidePanel] Initialized, collapsed:', isPanelCollapsed);
