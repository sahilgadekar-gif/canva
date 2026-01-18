const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); // Serve client files

// In-memory stores
let canvasObjects = {};     // { id: { type, x, y, width, height, color, text, ... } }
let cursors = {};           // { socket.id: { x, y } }
let lockedObjects = {};     // { objectId: socket.id } → who currently holds the lock

// Socket.io connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send current full state to new user
  socket.emit('init', {
    objects: canvasObjects,
    cursors: cursors,
    locked: lockedObjects
  });

  // ────────────────────────────────────────────────
  // Object creation
  // ────────────────────────────────────────────────
  socket.on('addObject', (data) => {
    // data = { obj }   (client sends the object without id)
    const id = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5);
    canvasObjects[id] = data.obj;

    // Broadcast with assigned id
    io.emit('addObject', { id, obj: data.obj });
  });

  // ────────────────────────────────────────────────
  // Object update (move / resize / etc.)
  // ────────────────────────────────────────────────
  socket.on('updateObject', ({ id, updates }) => {
    if (!canvasObjects[id]) return;

    // Check lock
    if (lockedObjects[id] && lockedObjects[id] !== socket.id) {
      // Someone else has the lock → reject
      socket.emit('updateRejected', { id, reason: 'locked' });
      return;
    }

    // Apply update
    Object.assign(canvasObjects[id], updates);

    // Broadcast to everyone (including sender for consistency)
    io.emit('updateObject', { id, updates });
  });

  // ────────────────────────────────────────────────
  // Object locking (during drag)
  // ────────────────────────────────────────────────
  socket.on('lockObject', ({ id }) => {
    if (!canvasObjects[id]) return;

    // Only allow lock if not already locked
    if (!lockedObjects[id]) {
      lockedObjects[id] = socket.id;
      io.emit('objectLocked', { id, by: socket.id });
      console.log(`Object ${id} locked by ${socket.id}`);
    }
  });

  socket.on('unlockObject', ({ id }) => {
    if (lockedObjects[id] === socket.id) {
      delete lockedObjects[id];
      io.emit('objectUnlocked', { id });
      console.log(`Object ${id} unlocked by ${socket.id}`);
    }
  });

  // ────────────────────────────────────────────────
  // Cursor tracking (real-time mouse position)
  // ────────────────────────────────────────────────
  socket.on('cursorMove', (pos) => {
    cursors[socket.id] = pos;
    // Broadcast only to others (reduce bandwidth)
    socket.broadcast.emit('cursorsUpdate', cursors);
  });

  // ────────────────────────────────────────────────
  // Cleanup on disconnect
  // ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Remove cursor
    delete cursors[socket.id];
    io.emit('cursorsUpdate', cursors);

    // Release all locks held by this user
    for (const id in lockedObjects) {
      if (lockedObjects[id] === socket.id) {
        delete lockedObjects[id];
        io.emit('objectUnlocked', { id });
      }
    }
  });
});

http.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});