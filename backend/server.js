const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In-Memory Data
let teachers = {}; // socketId -> teacher object
let incidents = [];

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // User logs in / sets their name
  socket.on('login', (data) => {
    teachers[socket.id] = {
      id: socket.id,
      name: data.name,
      room: data.room || '',
      isAvailable: false,
      capacity: 0
    };
    broadcastAvailableTeachers();
    socket.emit('login_success', teachers[socket.id]);
    
    // Aktive Vorfälle für diesen Nutzer senden
    const userIncidents = incidents.filter(i => i.senderId === socket.id || i.receiverId === socket.id);
    socket.emit('sync_incidents', userIncidents);
  });

  // User updates their availability status
  socket.on('update_status', (data) => {
    if (teachers[socket.id]) {
      teachers[socket.id].isAvailable = data.isAvailable;
      teachers[socket.id].capacity = data.capacity || 0;
      teachers[socket.id].room = data.room || teachers[socket.id].room;
      broadcastAvailableTeachers();
    }
  });

  // Send a student to a colleague
  socket.on('request_help', (data) => {
    // data: { studentName, receiverId }
    if (!teachers[socket.id]) return;
    
    const receiver = teachers[data.receiverId];
    if (receiver) {
      const incident = {
        id: Date.now().toString(),
        senderId: socket.id,
        senderName: teachers[socket.id].name,
        receiverId: data.receiverId,
        receiverName: receiver.name,
        studentName: data.studentName,
        status: 'sent',
        timestamp: new Date()
      };
      incidents.push(incident);

      // Notify the receiver
      io.to(data.receiverId).emit('incoming_student', incident);
      
      // Notify sender of success
      socket.emit('help_requested', { success: true, incident });
      
      syncUserIncidents(socket.id);
      syncUserIncidents(data.receiverId);
    } else {
      socket.emit('help_requested', { success: false, message: 'Kollege nicht mehr verfügbar.' });
    }
  });

  // Receiver confirms arrival
  socket.on('confirm_arrival', (data) => {
    const incident = incidents.find(i => i.id === data.incidentId);
    if (incident && incident.receiverId === socket.id) {
      incident.status = 'arrived';
      
      // Notify the sender
      io.to(incident.senderId).emit('student_arrived', incident);
      socket.emit('arrival_confirmed', { success: true, incident });
      
      syncUserIncidents(incident.senderId);
      syncUserIncidents(socket.id);
      
      // Optionally reduce capacity
      if (teachers[socket.id] && teachers[socket.id].capacity > 0) {
        teachers[socket.id].capacity -= 1;
        if (teachers[socket.id].capacity === 0) {
          teachers[socket.id].isAvailable = false;
        }
        broadcastAvailableTeachers();
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete teachers[socket.id];
    broadcastAvailableTeachers();
  });

  function broadcastAvailableTeachers() {
    const available = Object.values(teachers).filter(t => t.isAvailable && t.capacity > 0);
    io.emit('available_teachers', available);
  }

  function syncUserIncidents(userId) {
    if (teachers[userId]) {
      const userIncidents = incidents.filter(i => i.senderId === userId || i.receiverId === userId);
      io.to(userId).emit('sync_incidents', userIncidents);
    }
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
