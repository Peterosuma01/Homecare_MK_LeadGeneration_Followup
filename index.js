// API Handler for PWA
const API_CONFIG = {
  // UPDATE THIS with your deployed Google Apps Script URL
  baseUrl: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  isOnline: navigator.onLine
};

// Wrapper for API calls
async function callAPI(action, data = {}) {
  const payload = { action, ...data };
  
  // Check if online
  if (!navigator.onLine) {
    // Store action for later sync
    await storeOfflineAction(action, payload);
    showMessage('You are offline. This action will sync when connection is restored.', 'info');
    return { success: false, offline: true, message: 'Queued for sync' };
  }
  
  try {
    const response = await fetch(API_CONFIG.baseUrl, {
      method: 'POST',
      mode: 'no-cors', // For Google Apps Script
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('API Error:', error);
    // Store for offline sync
    await storeOfflineAction(action, payload);
    showMessage('Network error. Action saved for later sync.', 'error');
    return { success: false, error: error.message };
  }
}

// IndexedDB for offline storage
async function storeOfflineAction(action, data) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SWALOfflineDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pendingActions'], 'readwrite');
      const store = transaction.objectStore('pendingActions');
      
      const actionObj = {
        action: action,
        data: data,
        timestamp: new Date().toISOString(),
        url: API_CONFIG.baseUrl
      };
      
      const addRequest = store.add(actionObj);
      addRequest.onsuccess = () => resolve();
      addRequest.onerror = () => reject(addRequest.error);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingActions')) {
        db.createObjectStore('pendingActions', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('SW registered: ', registration);
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showMessage('New version available! Refresh to update.', 'info');
            }
          });
        });
      })
      .catch(error => {
        console.log('SW registration failed: ', error);
      });
  });
}

// Listen for online/offline events
window.addEventListener('online', () => {
  showMessage('You are back online! Syncing pending actions...', 'success');
  syncPendingActions();
});

window.addEventListener('offline', () => {
  showMessage('You are offline. Some features may be limited.', 'info');
});

// Sync pending actions when online
async function syncPendingActions() {
  const db = await openDatabase();
  const pendingActions = await getPendingActions(db);
  
  for (const action of pendingActions) {
    try {
      const response = await fetch(API_CONFIG.baseUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.data)
      });
      await removePendingAction(db, action.id);
      showMessage(`Action "${action.action}" synced successfully!`, 'success');
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }
}

// Replace all google.script.run calls with callAPI()
// Example:
// Before: google.script.run.withSuccessHandler(...).validateSupervisorPassword(pw)
// After: callAPI('validateSupervisorPassword', { password: pw })
