// public/client.js

const socket = io();

console.log("client.js loaded and socket.io connected");

let stage, layer, scale = 1, origin = { x: 0, y: 0 };
let isPanning = false;
let lastPointer = { x: 0, y: 0 };

let objects = {};
let cursors = {};
let cursorShapes = {};

let currentTool = 'select';

// ────────────────────────────────────────────────
// Wait for page to be fully loaded before creating canvas
// ────────────────────────────────────────────────
window.addEventListener('load', () => {
  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error("Element #canvas-container not found");
    return;
  }

  const width  = container.clientWidth  || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  console.log(`Initializing Konva stage: ${width} × ${height}`);

  stage = new Konva.Stage({
    container: 'canvas-container',
    width: width,
    height: height,
  });

  layer = new Konva.Layer();
  stage.add(layer);

  // ─── Static background and welcome text ───
  const bg = new Konva.Rect({
    x: -10000,
    y: -10000,
    width: 30000,
    height: 30000,
    fill: '#f8f9fa',
    listening: false,
  });
  layer.add(bg);

  const welcome = new Konva.Text({
    x: width / 2 - 240,
    y: height / 2 - 40,
    text: 'Canvas Ready – Start drawing!',
    fontSize: 36,
    fontFamily: 'Arial',
    fill: '#34495e',
    shadowColor: 'rgba(0,0,0,0.3)',
    shadowBlur: 4,
    shadowOffset: { x: 2, y: 2 },
  });
  layer.add(welcome);

  // Optional test shape (you can remove later)
  const testRect = new Konva.Rect({
    x: 120,
    y: 120,
    width: 220,
    height: 140,
    fill: '#3498db',
    stroke: '#2980b9',
    strokeWidth: 3,
    cornerRadius: 8,
    draggable: true,
  });
  layer.add(testRect);

  layer.draw();

  // ────────────────────────────────────────────────
  // Pan & Zoom
  // ────────────────────────────────────────────────

  stage.on('wheel', (e) => {
    e.evt.preventDefault();
    const oldScale = scale;
    scale *= e.evt.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.max(0.05, Math.min(20, scale));

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    origin.x = pointer.x - (pointer.x - origin.x) * (scale / oldScale);
    origin.y = pointer.y - (pointer.y - origin.y) * (scale / oldScale);

    updateTransform();
  });

  container.addEventListener('mousedown', (e) => {
    if (currentTool === 'select') return;
    isPanning = true;
    lastPointer = { x: e.clientX, y: e.clientY };
  });

  container.addEventListener('mousemove', (e) => {
    if (isPanning) {
      origin.x += e.clientX - lastPointer.x;
      origin.y += e.clientY - lastPointer.y;
      lastPointer = { x: e.clientX, y: e.clientY };
      updateTransform();
    } else {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      socket.emit('cursorMove', canvasPos);
    }
  });

  container.addEventListener('mouseup',   () => { isPanning = false; });
  container.addEventListener('mouseleave', () => { isPanning = false; });

  function updateTransform() {
    stage.scale({ x: scale, y: scale });
    stage.position(origin);
    stage.batchDraw();
  }

  // Coordinate helpers
  function screenToCanvas(sx, sy) {
    const pos = stage.getPointerPosition() || { x: sx, y: sy };
    return {
      x: (pos.x - origin.x) / scale,
      y: (pos.y - origin.y) / scale
    };
  }

  function canvasToScreen(cx, cy) {
    return {
      x: cx * scale + origin.x,
      y: cy * scale + origin.y
    };
  }

  // ────────────────────────────────────────────────
  // Click to place new shapes
  // ────────────────────────────────────────────────

  stage.on('click', (e) => {
    if (currentTool === 'select' || currentTool === 'pan') return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const canvasPos = screenToCanvas(pointer.x, pointer.y);

    let obj;
    const id = Date.now().toString();

    if (currentTool === 'rect') {
      obj = {
        type: 'rect',
        x: canvasPos.x,
        y: canvasPos.y,
        width: 180,
        height: 120,
        color: '#3498db'
      };
    } else if (currentTool === 'note') {
      const text = prompt("Enter note text:", "New sticky note");
      if (!text) return;
      obj = {
        type: 'note',
        x: canvasPos.x,
        y: canvasPos.y,
        text: text
      };
    }

    if (obj) {
      // Optimistic update: add locally first
      objects[id] = obj;
      addShapeToLayer(id, obj);
      layer.draw();

      // Send to everyone else
      socket.emit('addObject', { id, obj });
    }

    // Optional: reset to select after placing
    // setTool('select');
  });

  // ────────────────────────────────────────────────
  // Socket.io events
  // ────────────────────────────────────────────────

  socket.on('init', ({ objects: initObjects, cursors: initCursors }) => {
    objects = initObjects || {};
    cursors = initCursors || {};
    renderObjects();
    renderCursors();
  });

  socket.on('addObject', ({ id, obj }) => {
    objects[id] = obj;
    addShapeToLayer(id, obj);
  });

  socket.on('updateObject', ({ id, updates }) => {
    if (objects[id]) {
      Object.assign(objects[id], updates);
      updateShape(id, updates);
    }
  });

  socket.on('cursorsUpdate', (newCursors) => {
    cursors = newCursors;
    renderCursors();
  });

  // ────────────────────────────────────────────────
  // Render functions
  // ────────────────────────────────────────────────

  function renderObjects() {
    layer.removeChildren();

    layer.add(bg);
    layer.add(welcome);

    Object.entries(objects).forEach(([id, obj]) => addShapeToLayer(id, obj));

    layer.draw();
  }

  function addShapeToLayer(id, obj) {
    let shape;

    if (obj.type === 'rect') {
      shape = new Konva.Rect({
        id: String(id),
        x: obj.x,
        y: obj.y,
        width: obj.width || 160,
        height: obj.height || 100,
        fill: obj.color || '#e74c3c',
        stroke: '#c0392b',
        strokeWidth: 2,
        draggable: true,
      });
    } else if (obj.type === 'note') {
      // Background for note
      const noteBg = new Konva.Rect({
        x: obj.x - 8,
        y: obj.y - 8,
        width: 260,
        height: 160,
        fill: '#fff9c4',
        shadowColor: 'black',
        shadowBlur: 8,
        shadowOffset: { x: 4, y: 4 },
        listening: false,
      });
      layer.add(noteBg);

      shape = new Konva.Text({
        id: String(id),
        x: obj.x,
        y: obj.y,
        text: obj.text || 'New note',
        fontSize: 18,
        padding: 12,
        fill: 'black',
        draggable: true,
      });
    } else if (obj.type === 'line') {
      shape = new Konva.Line({
        id: String(id),
        points: obj.points || [0,0, 200,200],
        stroke: 'black',
        strokeWidth: 3,
        lineCap: 'round',
        draggable: false,
      });
    }

    if (shape) {
      shape.on('dragmove', () => {
        const pos = { x: shape.x(), y: shape.y() };
        objects[id] = { ...objects[id], ...pos };
        socket.emit('updateObject', { id, updates: pos });
      });

      layer.add(shape);
    }

    layer.draw();
  }

  function updateShape(id, updates) {
    const shape = layer.findOne('#' + id);
    if (shape) {
      shape.setAttrs(updates);
      layer.draw();
    }
  }

  function renderCursors() {
    Object.values(cursorShapes).forEach(s => s.destroy());
    cursorShapes = {};

    Object.entries(cursors).forEach(([userId, pos]) => {
      if (userId === socket.id) return;

      const screenPos = canvasToScreen(pos.x, pos.y);
      const cursor = new Konva.Circle({
        x: screenPos.x,
        y: screenPos.y,
        radius: 8,
        fill: '#e91e63',
        stroke: 'white',
        strokeWidth: 2,
        listening: false,
      });
      cursorShapes[userId] = cursor;
      stage.add(cursor);
    });

    stage.draw();
  }

  // ────────────────────────────────────────────────
  // Toolbar / Tool functions
  // ────────────────────────────────────────────────

  window.setTool = function(tool) {
    currentTool = tool;
    console.log("Tool changed to:", tool);
  };

  window.addRectangle = function() {
    setTool('rect');
  };

  window.addStickyNote = function() {
    setTool('note');
  };

  // ────────────────────────────────────────────────
  // Resize handler
  // ────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const newWidth  = container.clientWidth  || window.innerWidth;
    const newHeight = container.clientHeight || window.innerHeight;
    stage.width(newWidth);
    stage.height(newHeight);

    welcome.x(newWidth / 2 - 240);
    welcome.y(newHeight / 2 - 40);

    stage.draw();
  });

  console.log("Canvas setup complete – ready for drawing!");
});
