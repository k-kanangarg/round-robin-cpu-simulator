let processes = [];
let timeQuantum = 0;
let currentTime = 0;
let readyQueue = [];
let ganttChart = [];
let isPlaying = false;
let intervalId = null;
let currentExecuting = null;
let quantumRemaining = 0;
let history = [];
let historyIndex = -1;
let lastGanttProcess = null;
let ioQueue = [];
let mode = 'single';

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Helper: return an array of process IDs (or null)
function idsFrom(arr) {
  return (arr || []).map(p => (p ? p.id : null));
}

// Save state using IDs for queues to avoid object identity problems
function saveState() {
  const state = {
    currentTime,
    processes: deepClone(processes), // canonical snapshot of processes
    readyQueueIds: idsFrom(readyQueue),
    ioQueueIds: idsFrom(ioQueue),
    currentExecutingId: currentExecuting ? currentExecuting.id : null,
    quantumRemaining,
    ganttChart: deepClone(ganttChart),
    lastGanttProcess: lastGanttProcess ? deepClone(lastGanttProcess) : null
  };

  history = history.slice(0, historyIndex + 1);
  history.push(state);
  historyIndex++;
  document.getElementById('prevBtn').disabled = historyIndex <= 0 ? true : false;
}

// Restore a snapshot: rebuild queues mapping ids to snapshot's processes
function restoreState(state) {
  currentTime = state.currentTime;

  // restore canonical processes from snapshot
  processes = deepClone(state.processes);

  const findById = id => processes.find(p => p.id === id) || null;

  readyQueue = (state.readyQueueIds || []).map(id => findById(id)).filter(Boolean);
  ioQueue = (state.ioQueueIds || []).map(id => findById(id)).filter(Boolean);
  currentExecuting = state.currentExecutingId ? findById(state.currentExecutingId) : null;

  quantumRemaining = state.quantumRemaining;
  ganttChart = deepClone(state.ganttChart);
  lastGanttProcess = state.lastGanttProcess ? deepClone(state.lastGanttProcess) : null;

  updateDisplay();
}

function previousStep() {
  if (isPlaying) togglePlayPause(); // prevent running timer during undo
  if (historyIndex > 0) {
    historyIndex--;
    restoreState(history[historyIndex]);
    document.getElementById('statusText').textContent = 'Step reversed';
    document.getElementById('prevBtn').disabled = historyIndex <= 0;
  }
}

function generateProcessInputs() {
  const num = Math.min(parseInt(document.getElementById('numProcesses').value) || 5, 8);
  mode = document.getElementById('mode').value;
  const container = document.getElementById('processInputs');

  let processHeaders = '';
  let arrivalRow = '';
  let burstRows = '';

  if (mode === 'single') {
    // Process headers
    processHeaders = '<th>PROCESS</th>';
    for (let i = 0; i < num; i++) {
      processHeaders += `<th>P${i + 1}</th>`;
    }

    // Arrival time row
    arrivalRow = '<th>ARRIVAL TIME</th>';
    for (let i = 0; i < num; i++) {
      arrivalRow += `<td><input type="number" id="arrival${i}" min="0" value="${i}" /></td>`;
    }

    // Burst time row
    burstRows = '<th>BURST TIME</th>';
    for (let i = 0; i < num; i++) {
      const burst = Math.floor(Math.random() * 8) + 3;
      burstRows += `<td><input type="number" id="burst1${i}" min="1" value="${burst}" /></td>`;
    }

    container.innerHTML = `<table class="process-table-horizontal">
      <tr>${processHeaders}</tr>
      <tr>${arrivalRow}</tr>
      <tr>${burstRows}</tr>
    </table>`;
  } else {
    // Process headers
    processHeaders = '<th>PROCESS</th>';
    for (let i = 0; i < num; i++) {
      processHeaders += `<th>P${i + 1}</th>`;
    }

    // Arrival time row
    arrivalRow = '<th>ARRIVAL TIME</th>';
    for (let i = 0; i < num; i++) {
      arrivalRow += `<td><input type="number" id="arrival${i}" min="0" value="${i}" /></td>`;
    }

    // CPU Burst 1 row
    let burst1Row = '<th>CPU BURST 1</th>';
    for (let i = 0; i < num; i++) {
      const burst1 = Math.floor(Math.random() * 5) + 2;
      burst1Row += `<td><input type="number" id="burst1${i}" min="1" value="${burst1}" /></td>`;
    }

    // I/O 1 row
    let io1Row = '<th>I/O 1</th>';
    for (let i = 0; i < num; i++) {
      const io1 = Math.floor(Math.random() * 3) + 2;
      io1Row += `<td><input type="number" id="io1${i}" min="0" value="${io1}" /></td>`;
    }

    // CPU Burst 2 row
    let burst2Row = '<th>CPU BURST 2</th>';
    for (let i = 0; i < num; i++) {
      const burst2 = Math.floor(Math.random() * 4) + 1;
      burst2Row += `<td><input type="number" id="burst2${i}" min="0" value="${burst2}" /></td>`;
    }

    // I/O 2 row
    let io2Row = '<th>I/O 2</th>';
    for (let i = 0; i < num; i++) {
      const io2 = Math.floor(Math.random() * 3) + 1;
      io2Row += `<td><input type="number" id="io2${i}" min="0" value="${io2}" /></td>`;
    }

    // CPU Burst 3 row
    let burst3Row = '<th>CPU BURST 3</th>';
    for (let i = 0; i < num; i++) {
      const burst3 = Math.floor(Math.random() * 3) + 1;
      burst3Row += `<td><input type="number" id="burst3${i}" min="0" value="${burst3}" /></td>`;
    }

    container.innerHTML = `<table class="process-table-horizontal">
      <tr>${processHeaders}</tr>
      <tr>${arrivalRow}</tr>
      <tr>${burst1Row}</tr>
      <tr>${io1Row}</tr>
      <tr>${burst2Row}</tr>
      <tr>${io2Row}</tr>
      <tr>${burst3Row}</tr>
    </table>`;
  }

  document.getElementById('startControls').style.display = 'flex';
  document.getElementById('summaryTableContainer').innerHTML = '<div class="empty">Click "Start Simulation" to load</div>';
}

function startSimulation() {
  const num = parseInt(document.getElementById('numProcesses').value);
  timeQuantum = parseInt(document.getElementById('timeQuantum').value);
  mode = document.getElementById('mode').value;

  // --- Input validation ---
  if (isNaN(num) || num < 1) return alert("Enter a valid number of processes.");
  if (isNaN(timeQuantum) || timeQuantum <= 0) return alert("Time quantum must be ≥ 1.");

  processes = [];
  ioQueue = [];

  for (let i = 0; i < num; i++) {
    const arrival = parseInt(document.getElementById(`arrival${i}`).value);
    const burst1 = parseInt(document.getElementById(`burst1${i}`).value);

    if (burst1 <= 0) {
      alert(`Process P${i + 1} has invalid burst time.`);
      return;
    }

    let bursts = [burst1];
    let ios = [];

    if (mode === 'multiple') {
      const io1 = parseInt(document.getElementById(`io1${i}`).value) || 0;
      const burst2 = parseInt(document.getElementById(`burst2${i}`).value) || 0;
      const io2 = parseInt(document.getElementById(`io2${i}`).value) || 0;
      const burst3 = parseInt(document.getElementById(`burst3${i}`).value) || 0;

      if (io1 > 0 && burst2 > 0) {
        ios.push(io1);
        bursts.push(burst2);
      }
      if (io2 > 0 && burst3 > 0) {
        ios.push(io2);
        bursts.push(burst3);
      }
    }

    const totalBurst = bursts.reduce((a, b) => a + b, 0);

    const p = {
      id: `P${i + 1}`,
      arrivalTime: arrival,
      bursts: bursts,
      ios: ios,
      currentBurstIndex: 0,
      ioEndTime: -1,
      remainingTime: bursts[0] || 0,
      waitingTime: 0,
      turnaroundTime: 0,
      completionTime: 0,
      totalBurst: totalBurst,
      hasArrived: false,
      isCompleted: false,
      responseTime: null,
      respondedOnce: false,
    };

    if (p.totalBurst <= 0) p.isCompleted = true;

    processes.push(p);
  }

  processes.sort((a, b) => a.arrivalTime - b.arrivalTime);
  currentTime = 0;
  readyQueue = [];
  ganttChart = [];
  currentExecuting = null;
  quantumRemaining = 0;
  lastGanttProcess = null;
  history = [];
  historyIndex = -1;
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('prevBtn').disabled = true;

  // Enqueue processes that arrive at time 0 (they should be visible in ready queue)
  processes.forEach(p => {
    if (p.arrivalTime === 0) {
      readyQueue.push(p);
      p.hasArrived = true;
    }
  });

  // 🔧 Ensure we don't get stuck idle if all processes arrive later
  if (readyQueue.length === 0) {
    const earliest = Math.min(...processes.map(p => p.arrivalTime));
    currentTime = earliest;
    processes
      .filter(p => p.arrivalTime === earliest)
      .forEach(p => {
        readyQueue.push(p);
        p.hasArrived = true;
      });
  }

  // Build Summary Table
  let headerRow = '<tr><th>Process</th><th>Arrival</th><th>Total Burst</th></tr>';
  let rows = '';

  processes.forEach(p => {
    rows += `<tr><td>${p.id}</td><td>${p.arrivalTime}</td><td>${p.totalBurst}</td></tr>`;
  });

  document.getElementById('summaryTableContainer').innerHTML = `<table class="process-table">${headerRow}<tbody>${rows}</tbody></table>`;

  saveState();
  updateDisplay();
  document.getElementById('statusText').textContent = 'Simulation started';
}

function addToGantt(id, startTime, isIdle = false) {
  if (lastGanttProcess && lastGanttProcess.id === id && lastGanttProcess.isIdle === isIdle) {
    // Extend the same block
    lastGanttProcess.end = currentTime;
    ganttChart[ganttChart.length - 1] = lastGanttProcess;
  } else {
    // Finalize previous block before adding new
    const block = { id, start: startTime, end: currentTime, isIdle };
    ganttChart.push(block);
    lastGanttProcess = block;
  }
}

function updateDisplay() {
  document.getElementById('currentTime').textContent = currentTime;

  const queueDiv = document.getElementById('readyQueue');
  queueDiv.innerHTML = readyQueue.length === 0
    ? '<div class="empty">No processes in queue</div>'
    : readyQueue.map(p => `
      <div class="process-box">
        <div class="process-name">${p.id}${mode === 'multiple' ? ` (B${p.currentBurstIndex + 1})` : ''}</div>
        <div class="process-time">${p.remainingTime}/${p.bursts[p.currentBurstIndex]}</div>
      </div>`).join('');

  const execDiv = document.getElementById('executingProcess');
  execDiv.innerHTML = currentExecuting
    ? `<div style="color:#1e40af;font-weight:600;">${currentExecuting.id}${mode === 'multiple' ? ` (Burst ${currentExecuting.currentBurstIndex + 1})` : ''}<br><small>${currentExecuting.remainingTime} unit(s) left</small></div>`
    : '<div class="idle">CPU Idle</div>';

  const ioDiv = document.getElementById('ioQueue');
  ioDiv.innerHTML = ioQueue.length === 0
    ? '<div class="empty">No processes in I/O</div>'
    : ioQueue.map(p => `
      <div class="io-box">
        <div>${p.id}</div>
        <div style="font-size: 0.75rem;">Until t=${p.ioEndTime}</div>
      </div>`).join('');

  const ganttDiv = document.getElementById('ganttChart');
  ganttDiv.innerHTML = ganttChart.length === 0
    ? '<div class="empty">Execution timeline will appear here</div>'
    : ganttChart.map(entry => `
      <div class="gantt-block ${entry.isIdle ? 'idle' : ''}" style="min-width: 40px;">
        <div>${entry.id}</div>
        <div class="gantt-time">${entry.start}</div>
        <div class="gantt-time">${entry.end}</div>
      </div>
    `).join('');
}

function stepExecution() {
  // Save current state for undo
  saveState();

  // Process I/O completions first (those with ioEndTime <= currentTime)
  const completedIO = [];
  ioQueue.forEach((p, index) => {
    if (p.ioEndTime !== -1 && p.ioEndTime <= currentTime) {
      completedIO.push(index);
    }
  });

  completedIO.reverse().forEach(index => {
    const p = ioQueue.splice(index, 1)[0];
    p.currentBurstIndex++;
    if (p.currentBurstIndex < p.bursts.length) {
      p.remainingTime = p.bursts[p.currentBurstIndex];
      readyQueue.push(p);
      document.getElementById('statusText').textContent = `${p.id} returned from I/O (Burst ${p.currentBurstIndex + 1})`;
    } else {
      // Process completed after I/O
      p.completionTime = currentTime;
      p.turnaroundTime = p.completionTime - p.arrivalTime;
      p.waitingTime = p.turnaroundTime - p.totalBurst;
      p.isCompleted = true;
      document.getElementById('statusText').textContent = `${p.id} completed after I/O`;
    }
  });

  // Add newly arrived processes at this exact currentTime
  processes.forEach(p => {
    if (p.arrivalTime === currentTime && !p.hasArrived) {
      readyQueue.push(p);
      p.hasArrived = true;
      document.getElementById('statusText').textContent = `${p.id} arrived`;
    }
  });

  // Determine whether to pick a new process
  if (!currentExecuting || quantumRemaining === 0) {
    // If a process was executing and still has remainingTime, requeue it (preemption)
    if (currentExecuting && currentExecuting.remainingTime > 0) {
      readyQueue.push(currentExecuting);
      currentExecuting = null;
    }

    // If nothing in ready queue, handle idle/time advance (I1: step-by-step idle)
    if (readyQueue.length === 0) {
      const allDone = processes.every(p => p.isCompleted === true);
      const anyInIO = ioQueue.length > 0;

      if (allDone && !anyInIO) {
        return showResults();
      }

      const idleStart = currentTime;
      currentTime++;
      const remainingArrivals = processes.filter(p=>!p.hasArrived).map(p=>p.arrivalTime);
      const nextArrival = remainingArrivals.length ? Math.min(...remainingArrivals) : Infinity;
      addToGantt("Idle", idleStart, true);
      document.getElementById('statusText').textContent =
        `CPU Idle — next process arrives at t=${isFinite(nextArrival) ? nextArrival : currentTime}`;
      updateDisplay();
      return;
    }

    // Pick next process from ready queue
    currentExecuting = readyQueue.shift();
    quantumRemaining = Math.min(timeQuantum, currentExecuting.remainingTime);
    document.getElementById('statusText').textContent =
      `${currentExecuting.id} executing${mode === 'multiple' ? ` (Burst ${currentExecuting.currentBurstIndex + 1})` : ''}`;
    // Record response time (only first time the process ever gets CPU)
    if (currentExecuting.responseTime === null && !currentExecuting.respondedOnce) {
      currentExecuting.responseTime = currentTime - currentExecuting.arrivalTime;
      currentExecuting.respondedOnce = true;
    }
  }

  // Execute for one time unit
  const execStart = currentTime;
  currentExecuting.remainingTime--;
  quantumRemaining--;
  currentTime++;
  addToGantt(currentExecuting.id, execStart, false);

  // Check if current burst finished
  if (currentExecuting.remainingTime === 0) {
    if (currentExecuting.currentBurstIndex < currentExecuting.bursts.length - 1) {
      // Has more bursts -> move to I/O
      currentExecuting.ioEndTime = currentTime + currentExecuting.ios[currentExecuting.currentBurstIndex];
      ioQueue.push(currentExecuting);
      document.getElementById('statusText').textContent =
        `${currentExecuting.id} moved to I/O (${currentExecuting.ios[currentExecuting.currentBurstIndex]} units)`;
    } else {
      // Last burst completed -> process done
      currentExecuting.completionTime = currentTime;
      currentExecuting.turnaroundTime = currentExecuting.completionTime - currentExecuting.arrivalTime;
      currentExecuting.waitingTime = currentExecuting.turnaroundTime - currentExecuting.totalBurst;
      currentExecuting.isCompleted = true;
      document.getElementById('statusText').textContent = `${currentExecuting.id} completed`;
    }
    currentExecuting = null;
    lastGanttProcess = null;
  } else if (quantumRemaining === 0) {
    // Quantum expired but not finished -> requeue
    readyQueue.push(currentExecuting);
    currentExecuting = null;
    lastGanttProcess = null;
  }

  // 🔧 FIX: Immediately pick next if CPU freed and ready queue has processes (for visual seamlessness)
  // This sets executing for display but doesn't advance time—next step executes.
  if (!currentExecuting && readyQueue.length > 0) {
    currentExecuting = readyQueue.shift();
    quantumRemaining = Math.min(timeQuantum, currentExecuting.remainingTime);
    document.getElementById('statusText').textContent = `Switching to ${currentExecuting.id}${mode === 'multiple' ? ` (Burst ${currentExecuting.currentBurstIndex + 1})` : ''}`;
    if (currentExecuting.responseTime === null && !currentExecuting.respondedOnce) {
      currentExecuting.responseTime = currentTime - currentExecuting.arrivalTime;
      currentExecuting.respondedOnce = true;
    }
    // Update display immediately to show the switch (no time advance)
    const execDiv = document.getElementById('executingProcess');
    execDiv.innerHTML = `<div style="color:#1e40af;font-weight:600;">${currentExecuting.id}${mode === 'multiple' ? ` (Burst ${currentExecuting.currentBurstIndex + 1})` : ''}<br><small>${currentExecuting.remainingTime} unit(s) left</small></div>`;
  }

  updateDisplay();

  // Check if finished globally
  if (processes.every(p => p.isCompleted === true)) {
    showResults();
  }
}

function togglePlayPause() {
  isPlaying = !isPlaying;
  const btn = document.getElementById('playPauseBtn');
  const stepBtn = document.getElementById('stepBtn');

  if (isPlaying) {
    btn.textContent = 'Pause';
    stepBtn.disabled = true;
    document.getElementById('prevBtn').disabled = true;
    intervalId = setInterval(stepExecution, 800);
  } else {
    btn.textContent = 'Play';
    stepBtn.disabled = false;
    document.getElementById('prevBtn').disabled = historyIndex <= 0;
    clearInterval(intervalId);
  }
}

function showResults() {
  if (isPlaying) togglePlayPause();
  document.getElementById('resultsSection').style.display = 'block';

  const valid = processes.filter(p => p.totalBurst > 0);
  const totalWait = valid.reduce((sum, p) => sum + p.waitingTime, 0);
  const totalTurn = valid.reduce((sum, p) => sum + p.turnaroundTime, 0);

  document.getElementById('avgWaitTime').textContent = (totalWait / valid.length).toFixed(1);
  document.getElementById('avgTurnTime').textContent = (totalTurn / valid.length).toFixed(1);

  const tbody = document.getElementById('resultsBody');
  tbody.innerHTML = processes.map(p => `
    <tr>
      <td style="color:#1e40af;font-weight:600;">${p.id}</td>
      <td>${p.arrivalTime}</td>
      <td>${p.totalBurst}</td>
      <td>${p.completionTime}</td>
      <td>${p.turnaroundTime}</td>
      <td>${p.waitingTime}</td>
      <td>${p.responseTime !== null ? p.responseTime : '-'}</td>
    </tr>
  `).join('');

  document.getElementById('statusText').textContent = 'Simulation completed!';
}

function resetSimulation() {
  if (isPlaying) togglePlayPause();

  currentTime = 0;
  readyQueue = [];
  ganttChart = [];
  currentExecuting = null;
  quantumRemaining = 0;
  ioQueue = [];
  lastGanttProcess = null;
  history = [];
  historyIndex = -1;

  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('prevBtn').disabled = true;
  document.getElementById('statusText').textContent = 'Click "Start" to begin';
  document.getElementById('summaryTableContainer').innerHTML = '<div class="empty">Click "Start Simulation" to load</div>';

  updateDisplay();
}

window.onload = () => generateProcessInputs();