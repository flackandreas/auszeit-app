import { io } from 'socket.io-client';

// Konstanten & DOM Elemente
// Ohne Argument verbindet sich Socket.IO mit der Herkunft, von der die Seite
// geladen wurde. Damit entfaellt die fest verdrahtete Adresse, die im
// Produktivbetrieb auf den Rechner der Besucherin zeigte.
const socket = io();

// Views
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const emergencyView = document.getElementById('emergency-view');
const notificationLayer = document.getElementById('notification-layer');

// Login Elements
const inputName = document.getElementById('teacher-name');
const inputRoom = document.getElementById('teacher-room');
const btnLogin = document.getElementById('btn-login');

// Dashboard Elements
const displayName = document.getElementById('display-name');
const displayRoom = document.getElementById('display-room');
const btnLogout = document.getElementById('btn-logout');
const statusToggle = document.getElementById('status-toggle');
const statusText = document.getElementById('status-text');
const capacitySelector = document.getElementById('capacity-selector');
const capBtns = document.querySelectorAll('.cap-btn');
const btnEmergency = document.getElementById('btn-emergency');

// Emergency Elements
const btnBackDashboard = document.getElementById('btn-back-dashboard');
const inputStudentName = document.getElementById('student-name');
const teachersList = document.getElementById('available-teachers-list');

// Notification Elements
const notificationText = document.getElementById('notification-text');
const btnConfirmArrival = document.getElementById('btn-confirm-arrival');
const toast = document.getElementById('toast');

// State
let currentUser = null;
let currentCapacity = 0;
let availableTeachers = [];
let activeIncidentId = null;

// --- Helper Functions ---
function switchView(viewElement) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  viewElement.classList.add('active-view');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- Socket.io Events ---
socket.on('connect', () => {
  console.log('Connected to server');
  // Auto-login wenn Session Storage existiert
  const savedUser = sessionStorage.getItem('auszeit_user');
  if (savedUser) {
    const user = JSON.parse(savedUser);
    inputName.value = user.name;
    inputRoom.value = user.room;
    btnLogin.click();
  }
});

socket.on('login_success', (user) => {
  currentUser = user;
  sessionStorage.setItem('auszeit_user', JSON.stringify(user));
  displayName.textContent = user.name;
  displayRoom.textContent = `Raum ${user.room}`;
  switchView(dashboardView);
});

socket.on('available_teachers', (teachers) => {
  // Filtere mich selbst heraus
  availableTeachers = teachers.filter(t => t.id !== socket.id);
  renderTeachersList();
});

socket.on('incoming_student', (incident) => {
  activeIncidentId = incident.id;
  notificationText.innerHTML = `<strong>${incident.senderName}</strong> schickt <strong>${incident.studentName || 'einen Schüler'}</strong> zu dir.`;
  notificationLayer.classList.remove('hidden');
  
  // Optional: Vibrate if supported
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 100, 500]);
  }
});

socket.on('help_requested', (response) => {
  if (response.success) {
    showToast(`Schüler auf dem Weg zu ${response.incident.receiverName}`);
    inputStudentName.value = '';
    switchView(dashboardView);
  } else {
    showToast(response.message || 'Fehler beim Senden.');
  }
});

socket.on('student_arrived', (incident) => {
  showToast(`${incident.studentName || 'Schüler'} ist sicher bei ${incident.receiverName} angekommen.`);
  if (navigator.vibrate) navigator.vibrate(200);
});

socket.on('sync_incidents', (incidents) => {
  const container = document.getElementById('incidents-container');
  const list = document.getElementById('incidents-list');
  
  if (incidents.length === 0) {
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  list.innerHTML = '';
  
  // Sortiere: Neueste zuerst
  incidents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  incidents.forEach(inc => {
    const isSender = inc.senderId === socket.id;
    const statusText = inc.status === 'arrived' ? 'Angekommen' : 'Auf dem Weg';
    const statusClass = inc.status === 'arrived' ? 'arrived' : '';
    
    const timeString = new Date(inc.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const student = inc.studentName || 'Ein Schüler';
    
    const el = document.createElement('div');
    el.className = `incident-item ${isSender ? 'sent' : 'received'}`;
    
    if (isSender) {
      el.innerHTML = `
        <div class="incident-meta">
          <span>An: ${inc.receiverName}</span>
          <span>${timeString}</span>
        </div>
        <div><strong>${student}</strong></div>
        <div class="incident-meta mt-1">
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="incident-meta">
          <span>Von: ${inc.senderName}</span>
          <span>${timeString}</span>
        </div>
        <div><strong>${student}</strong></div>
        <div class="incident-meta mt-1">
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
      `;
    }
    list.appendChild(el);
  });
});

// --- UI Event Listeners ---

// Login
btnLogin.addEventListener('click', () => {
  const name = inputName.value.trim();
  const room = inputRoom.value.trim();
  if (name && room) {
    socket.emit('login', { name, room });
  } else {
    showToast('Bitte Name und Raum eingeben.');
  }
});

// Logout
btnLogout.addEventListener('click', () => {
  sessionStorage.removeItem('auszeit_user');
  socket.disconnect();
  socket.connect(); // Reconnect fresh
  statusToggle.checked = false;
  capacitySelector.classList.add('hidden');
  statusText.textContent = 'Keine Aufnahme';
  statusText.className = 'status-text text-red';
  switchView(loginView);
});

// Status Toggle
statusToggle.addEventListener('change', (e) => {
  if (e.target.checked) {
    statusText.textContent = 'Bereit zur Aufnahme';
    statusText.className = 'status-text text-green';
    capacitySelector.classList.remove('hidden');
    // Default 1 Platz
    if (currentCapacity === 0) {
      capBtns[0].click();
    } else {
      updateStatusOnServer();
    }
  } else {
    statusText.textContent = 'Keine Aufnahme';
    statusText.className = 'status-text text-red';
    capacitySelector.classList.add('hidden');
    currentCapacity = 0;
    capBtns.forEach(b => b.classList.remove('selected'));
    updateStatusOnServer();
  }
});

// Capacity Buttons
capBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    capBtns.forEach(b => b.classList.remove('selected'));
    e.target.classList.add('selected');
    currentCapacity = parseInt(e.target.getAttribute('data-cap'));
    updateStatusOnServer();
  });
});

function updateStatusOnServer() {
  socket.emit('update_status', {
    isAvailable: statusToggle.checked,
    capacity: currentCapacity,
    room: currentUser?.room
  });
}

// Emergency Navigation
btnEmergency.addEventListener('click', () => {
  switchView(emergencyView);
  // Optional: Auto-focus Name input, but on mobile it brings up keyboard and hides list
});

btnBackDashboard.addEventListener('click', () => {
  switchView(dashboardView);
});

// Render Teachers List
function renderTeachersList() {
  teachersList.innerHTML = '';
  if (availableTeachers.length === 0) {
    teachersList.innerHTML = '<div class="empty-state">Aktuell keine Kollegen verfügbar.</div>';
    return;
  }

  availableTeachers.forEach(teacher => {
    const el = document.createElement('div');
    el.className = 'teacher-item';
    el.innerHTML = `
      <div class="t-info">
        <span class="t-name">${teacher.name}</span>
        <span class="t-room">Raum ${teacher.room}</span>
      </div>
      <div class="t-cap">${teacher.capacity} Platz</div>
    `;
    
    el.addEventListener('click', () => {
      // Send Request
      const studentName = inputStudentName.value.trim() || 'Ein Schüler';
      socket.emit('request_help', {
        studentName: studentName,
        receiverId: teacher.id
      });
    });
    
    teachersList.appendChild(el);
  });
}

// Confirm Arrival
btnConfirmArrival.addEventListener('click', () => {
  if (activeIncidentId) {
    socket.emit('confirm_arrival', { incidentId: activeIncidentId });
    notificationLayer.classList.add('hidden');
    activeIncidentId = null;
  }
});
