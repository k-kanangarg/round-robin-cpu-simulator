const processColors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1'];
function getProcessColor(id) {
  const idx = (parseInt(id.replace('P','')) - 1);
  return processColors[(idx % processColors.length + processColors.length) % processColors.length];
}

let readyQueue = [], ioQueue = [], ganttChart = [];
let currentExecuting = null, quantumRemaining = 0;
let isPlaying = false, intervalId = null;
let history = [], historyIndex = -1;
let executionTrace = [], contextSwitches = 0, cpuIdleTime = 0;
let animationMultiplier = 1.0;
const baseDelay = 800;
let mode = 'single';
let isInContextSwitch = false, contextSwitchEndTime = 0;
let currentTime = 0, processes = [], timeQuantum = 0, contextSwitchTime = 0;
let cpuWasIdle = true;
let lastExecutedProcess = null;

const get = id => document.getElementById(id);

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function addTrace(event) {
  executionTrace.push({ time: currentTime, event });
}

function saveState() {
  const state = {
    currentTime, processes: deepClone(processes),
    readyQueue: readyQueue.map(p => p.id),
    ioQueue: ioQueue.map(p => p.id),
    currentExecuting: currentExecuting ? currentExecuting.id : null,
    quantumRemaining, ganttChart: deepClone(ganttChart),
    contextSwitches, cpuIdleTime, executionTrace: deepClone(executionTrace),
    isInContextSwitch, contextSwitchEndTime, cpuWasIdle, lastExecutedProcess
  };
  history = history.slice(0, historyIndex + 1);
  history.push(state);
  historyIndex++;
  get('prevBtn').disabled = historyIndex === 0;
}

function restoreState(state) {
  if (!state) return;
  currentTime = state.currentTime;
  processes = deepClone(state.processes);
  const find = id => processes.find(p => p.id === id);
  readyQueue = (state.readyQueue || []).map(find).filter(Boolean);
  ioQueue = (state.ioQueue || []).map(find).filter(Boolean);
  currentExecuting = state.currentExecuting ? find(state.currentExecuting) : null;
  quantumRemaining = state.quantumRemaining;
  ganttChart = deepClone(state.ganttChart);
  contextSwitches = state.contextSwitches;
  cpuIdleTime = state.cpuIdleTime;
  executionTrace = deepClone(state.executionTrace);
  isInContextSwitch = state.isInContextSwitch || false;
  contextSwitchEndTime = state.contextSwitchEndTime || 0;
  cpuWasIdle = state.cpuWasIdle;
  lastExecutedProcess = state.lastExecutedProcess;
  updateDisplay();
}

function updateBurstCountVisibility() {
  const modeVal = get('mode').value;
  get('burstCountRow').style.display = modeVal === 'multiple' ? 'flex' : 'none';
  if (modeVal === 'single') get('burstCount').value = '3';
  generateProcessInputs();
}

function generateProcessInputs() {
  const num = Math.min(parseInt(get('numProcesses').value) || 5, 10);
  mode = get('mode').value;
  const maxBursts = mode === 'multiple' ? parseInt(get('burstCount').value) : 1;
  const container = get('processInputs');
  let html = '<table class="process-table-horizontal"><tr><th>PROCESS</th>';
  for (let i = 0; i < num; i++) html += `<th>P${i + 1}</th>`;
  html += '</tr><tr><th>ARRIVAL TIME</th>';
  for (let i = 0; i < num; i++) html += `<td><input type="number" id="arrival${i}" min="0" value="${i}"></td>`;
  html += '</tr>';

  if (mode === 'single') {
    html += '<tr><th>BURST TIME</th>';
    for (let i = 0; i < num; i++) {
      const b = Math.floor(Math.random() * 8) + 3;
      html += `<td><input type="number" id="burst1${i}" min="1" value="${b}"></td>`;
    }
  } else {
    for (let b = 1; b <= maxBursts; b++) {
      html += `<tr><th>CPU BURST ${b}</th>`;
      for (let i = 0; i < num; i++) {
        const val = b === 1 ? Math.floor(Math.random() * 5) + 2 : Math.floor(Math.random() * 4) + 1;
        html += `<td><input type="number" id="burst${b}${i}" min="0" value="${val}"></td>`;
      }
      html += '</tr>';
      if (b < maxBursts) {
        html += `<tr><th>I/O ${b}</th>`;
        for (let i = 0; i < num; i++) {
          html += `<td><input type="number" id="io${b}${i}" min="0" value="${Math.floor(Math.random() * 3) + 1}"></td>`;
        }
        html += '</tr>';
      }
    }
  }
  html += '</table>';
  container.innerHTML = html;
  get('startControls').style.display = 'flex';
  enableExports(false);
}

function startSimulation() {
  const num = parseInt(get('numProcesses').value);
  timeQuantum = parseInt(get('timeQuantum').value);
  contextSwitchTime = parseInt(get('contextSwitchTime').value);
  const maxBursts = mode === 'multiple' ? parseInt(get('burstCount').value) : 1;

  if (isNaN(num) || num < 1 || num > 10 || isNaN(timeQuantum) || timeQuantum < 1) {
    return alert("Invalid input");
  }
  if (isNaN(contextSwitchTime) || contextSwitchTime < 0) {
    return alert("Invalid context switch time");
  }

  processes = []; readyQueue = []; ioQueue = []; ganttChart = [];
  currentExecuting = null; quantumRemaining = 0;
  history = []; historyIndex = -1; executionTrace = [];
  contextSwitches = 0; cpuIdleTime = 0; cpuWasIdle = true;
  isInContextSwitch = false; contextSwitchEndTime = 0;
  currentTime = 0; lastExecutedProcess = null;

  for (let i = 0; i < num; i++) {
    const arrival = parseInt(get(`arrival${i}`).value) || 0;
    let bursts = [], ios = [];
    if (mode === 'single') {
      const b1 = parseInt(get(`burst1${i}`).value) || 0;
      if (b1 > 0) bursts.push(b1);
    } else {
      for (let b = 1; b <= maxBursts; b++) {
        const burst = parseInt(get(`burst${b}${i}`).value) || 0;
        if (burst > 0) {
          bursts.push(burst);
          if (b < maxBursts) ios.push(parseInt(get(`io${b}${i}`).value) || 0);
        }
      }
    }
    const total = bursts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    processes.push({
      id: `P${i + 1}`, arrivalTime: arrival, bursts, ios,
      currentBurstIndex: 0, ioEndTime: -1, remainingTime: bursts[0],
      totalBurst: total, hasArrived: false, isCompleted: false,
      responseTime: null, respondedOnce: false
    });
  }

  processes.sort((a, b) => a.arrivalTime - b.arrivalTime);
  get('resultsSection').style.display = 'none';
  get('detailedStats').style.display = 'none';

  const firstArrival = processes.length ? processes[0].arrivalTime : 0;
  if (firstArrival > 0) {
    for (let t = 0; t < firstArrival; t++) {
      addToGantt('IDLE', t, true);
    }
    cpuIdleTime += firstArrival;
    currentTime = firstArrival;
    addTrace(`CPU idle from t=0 to t=${firstArrival - 1}`);
  }

  processes.filter(p => p.arrivalTime <= currentTime).forEach(p => {
    if (!p.hasArrived) {
      readyQueue.push(p); p.hasArrived = true;
      addTrace(`${p.id} arrived`);
    }
  });

  const summary = get('summaryTableContainer');
  let rows = '';
  processes.forEach(p => {
    rows += `<tr><td>${p.id}</td><td>${p.arrivalTime}</td><td>${p.totalBurst}</td></tr>`;
  });
  summary.innerHTML = `<table class="process-table"><tr><th>Process</th><th>Arrival</th><th>Total Burst</th></tr>${rows}</table>`;

  saveState();
  updateDisplay();
  addTrace('Simulation started');
  enableExports(false);
}

function addToGantt(id, time, isIdle = false, isCS = false, explicitEnd = null) {
  const last = ganttChart[ganttChart.length - 1];
  const start = time;
  const end = explicitEnd !== null ? explicitEnd : time + 1;

  if (last && last.id === id && last.isIdle === isIdle && last.isContextSwitch === isCS && last.end === start) {
    last.end = end;
  } else {
    ganttChart.push({ id, start, end, isIdle, isContextSwitch: isCS });
  }
}

function startContextSwitch() {
  if (mode !== 'multiple') return false;
  if (contextSwitchTime <= 0) return false;
  if (readyQueue.length === 0) return false;
  if (cpuWasIdle) return false;

  const nextProc = readyQueue[0];
  if (lastExecutedProcess && nextProc.id === lastExecutedProcess.id) {
    return false; // same process → no CS
  }

  isInContextSwitch = true;
  contextSwitchEndTime = currentTime + contextSwitchTime;
  contextSwitches++;
  addTrace(`Context switch started (ends at t=${contextSwitchEndTime})`);
  addToGantt('CS', currentTime, false, true, contextSwitchEndTime);
  cpuWasIdle = false;
  return true;
}

function stepExecution() {
  if (processes.every(p => p.isCompleted)) { showResults(); return; }

  // === 1. ARRIVALS AT CURRENT TIME ===
  processes.filter(p => p.arrivalTime === currentTime && !p.hasArrived).forEach(p => {
    readyQueue.push(p); p.hasArrived = true;
    addTrace(`${p.id} arrived`);
  });

  // === 2. I/O COMPLETION AT CURRENT TIME ===
  if (mode === 'multiple') {
    ioQueue = ioQueue.filter(p => {
      if (p.ioEndTime === currentTime) {
        p.currentBurstIndex++;
        if (p.currentBurstIndex < p.bursts.length) {
          p.remainingTime = p.bursts[p.currentBurstIndex];
          readyQueue.push(p);
          addTrace(`${p.id} completed I/O, back to ready`);
          return false;
        } else {
          p.isCompleted = true;
          p.completionTime = currentTime;
          addTrace(`${p.id} completed`);
          return false;
        }
      }
      return true;
    });
  }

  // === 3. CONTEXT SWITCH IN PROGRESS ===
  if (isInContextSwitch) {
    if (currentTime + 1 >= contextSwitchEndTime) {
      isInContextSwitch = false;
      addTrace('Context switch completed');
      if (readyQueue.length > 0) {
        currentExecuting = readyQueue.shift();
        quantumRemaining = timeQuantum;
        if (!currentExecuting.respondedOnce) {
          currentExecuting.responseTime = currentTime + 1 - currentExecuting.arrivalTime;
          currentExecuting.respondedOnce = true;
        }
        addTrace(`${currentExecuting.id} loaded onto CPU`);
        lastExecutedProcess = currentExecuting;
        cpuWasIdle = false;
      } else {
        cpuWasIdle = true;
      }
    }
    currentTime++;
    saveState();
    updateDisplay();
    return;
  }

  // === 4. NO PROCESS RUNNING → LOAD ONE OR JUMP ===
  if (!currentExecuting) {
    if (readyQueue.length > 0) {
      const nextProc = readyQueue[0];

      // Same process → no CS
      if (lastExecutedProcess && nextProc.id === lastExecutedProcess.id) {
        currentExecuting = readyQueue.shift();
        quantumRemaining = timeQuantum;
        if (!currentExecuting.respondedOnce) {
          currentExecuting.responseTime = currentTime - currentExecuting.arrivalTime;
          currentExecuting.respondedOnce = true;
        }
        addTrace(`${currentExecuting.id} resumed without context switch`);
        lastExecutedProcess = currentExecuting;
        cpuWasIdle = false;
      }
      // Different process → CS in multiple mode
      else if (mode === 'multiple' && contextSwitchTime > 0) {
        if (!startContextSwitch()) {
          currentExecuting = readyQueue.shift();
          quantumRemaining = timeQuantum;
          if (!currentExecuting.respondedOnce) {
            currentExecuting.responseTime = currentTime - currentExecuting.arrivalTime;
            currentExecuting.respondedOnce = true;
          }
          lastExecutedProcess = currentExecuting;
          addTrace(`${currentExecuting.id} started execution (no CS)`);
          cpuWasIdle = false;
        }
      }
      // Single mode or no CS
      else {
        currentExecuting = readyQueue.shift();
        quantumRemaining = timeQuantum;
        if (!currentExecuting.respondedOnce) {
          currentExecuting.responseTime = currentTime - currentExecuting.arrivalTime;
          currentExecuting.respondedOnce = true;
        }
        lastExecutedProcess = currentExecuting;
        addTrace(`${currentExecuting.id} started execution`);
        cpuWasIdle = false;
      }
    }
    else {
      // === NO READY PROCESS → FIND NEXT EVENT ===
      let nextEventTime = Infinity;

      // Next arrival
      processes.forEach(p => {
        if (!p.hasArrived && p.arrivalTime < nextEventTime) {
          nextEventTime = p.arrivalTime;
        }
      });

      // Next I/O
      if (mode === 'multiple') {
        ioQueue.forEach(p => {
          if (p.ioEndTime < nextEventTime) {
            nextEventTime = p.ioEndTime;
          }
        });
      }

      if (nextEventTime === Infinity) {
        showResults();
        return;
      }

      // === ONLY JUMP IF NO PROCESSES IN READY QUEUE ===
      if (nextEventTime > currentTime) {
        const hasIO = mode === 'multiple' && ioQueue.length > 0;
        if (!hasIO) {
          for (let t = currentTime; t < nextEventTime; t++) {
            addToGantt('IDLE', t, true);
            cpuIdleTime++;
          }
          addTrace(`CPU idle from t=${currentTime} to t=${nextEventTime - 1}`);
        } else {
          addTrace(`Time advances to t=${nextEventTime} (processes in I/O)`);
        }
        currentTime = nextEventTime;
        saveState();
        updateDisplay();
        return;
      }
    }
  }

  // === 5. EXECUTE ONE TICK ===
  if (quantumRemaining > 0 && currentExecuting && currentExecuting.remainingTime > 0) {
    addToGantt(currentExecuting.id, currentTime);
    currentExecuting.remainingTime--;
    quantumRemaining--;
    lastExecutedProcess = currentExecuting;
    cpuWasIdle = false;
  }

  // === 6. BURST COMPLETED ===
  if (currentExecuting && currentExecuting.remainingTime === 0) {
    if (mode === 'multiple' && currentExecuting.currentBurstIndex < currentExecuting.bursts.length - 1) {
      const ioTime = currentExecuting.ios[currentExecuting.currentBurstIndex] || 0;
      currentExecuting.ioEndTime = currentTime + 1 + ioTime;
      ioQueue.push(currentExecuting);
      addTrace(`${currentExecuting.id} sent to I/O (ends t=${currentExecuting.ioEndTime})`);
    } else {
      currentExecuting.isCompleted = true;
      currentExecuting.completionTime = currentTime + 1;
      addTrace(`${currentExecuting.id} completed at t=${currentExecuting.completionTime}`);
    }
    currentExecuting = null;
  }
  // === 7. QUANTUM EXPIRED ===
  else if (quantumRemaining === 0) {
    readyQueue.push(currentExecuting);
    addTrace(`${currentExecuting.id} preempted (quantum expired)`);
    currentExecuting = null;
  }

  currentTime++;
  saveState();
  updateDisplay();

  if (processes.every(p => p.isCompleted)) showResults();
}

function updateGantt() {
  const container = get('ganttChart');
  container.innerHTML = ganttChart.map(b => {
    const w = (b.end - b.start) * 40;
    let cls = 'gantt-block', bg = '';
    if (b.isContextSwitch) { cls += ' context-switch'; bg = '#fbbf24'; }
    else if (b.isIdle) { cls += ' idle'; bg = '#e5e7eb'; }
    else bg = getProcessColor(b.id);
    return `<div class="${cls}" style="width:${w}px;background:${bg}">
      <div class="gantt-time">${b.start}</div>
      <div class="gantt-label">${b.id}</div>
      <div class="gantt-time">${b.end}</div>
    </div>`;
  }).join('');
}

function updateDisplay() {
  get('currentTime').textContent = currentTime;
  get('readyQueue').innerHTML = readyQueue.length
    ? readyQueue.map(p => `<div class="process-box">${p.id}<br><small>${p.remainingTime}</small></div>`).join('')
    : '<div class="empty">No processes</div>';
  get('ioQueue').innerHTML = ioQueue.length
    ? ioQueue.map(p => `<div class="io-box">${p.id}<br><small>ends t=${p.ioEndTime}</small></div>`).join('')
    : '<div class="empty">No processes</div>';

  const exec = get('executingProcess');
  if (isInContextSwitch) {
    exec.innerHTML = `<div style="color:#f59e0b;">Context Switch<br><small>ends t=${contextSwitchEndTime}</small></div>`;
  } else if (currentExecuting) {
    exec.innerHTML = `<div style="color:#1e40af;">${currentExecuting.id}<br><small>${currentExecuting.remainingTime} left</small></div>`;
  } else {
    exec.innerHTML = '<div class="idle">CPU Idle</div>';
  }

  updateGantt();
}

function togglePlayPause() {
  isPlaying = !isPlaying;
  get('playPauseBtn').textContent = isPlaying ? 'Pause' : 'Play';
  get('stepBtn').disabled = isPlaying;
  get('prevBtn').disabled = isPlaying || historyIndex === 0;
  if (isPlaying) {
    const delay = Math.max(20, Math.round(baseDelay / animationMultiplier));
    intervalId = setInterval(stepExecution, delay);
  } else {
    clearInterval(intervalId);
  }
}

function previousStep() {
  if (isPlaying) togglePlayPause();
  if (historyIndex > 0) {
    historyIndex--;
    restoreState(history[historyIndex]);
  }
}

function showResults() {
  if (isPlaying) togglePlayPause();
  get('resultsSection').style.display = 'block';
  get('detailedStats').style.display = 'block';
  enableExports(true);

  const valid = processes.filter(p => p.totalBurst > 0);
  const totalWT = valid.reduce((s, p) => s + (p.completionTime - p.arrivalTime - p.totalBurst), 0);
  const totalTAT = valid.reduce((s, p) => s + (p.completionTime - p.arrivalTime), 0);

  get('avgWaitTime').textContent = (totalWT / valid.length).toFixed(1);
  get('avgTurnTime').textContent = (totalTAT / valid.length).toFixed(1);

  const tbody = get('resultsBody');
  tbody.innerHTML = processes.map(p => `<tr>
    <td>${p.id}</td><td>${p.arrivalTime}</td><td>${p.totalBurst}</td>
    <td>${p.completionTime}</td><td>${p.completionTime - p.arrivalTime}</td>
    <td>${p.completionTime - p.arrivalTime - p.totalBurst}</td>
    <td>${p.responseTime !== null ? p.responseTime : '-'}</td>
  </tr>`).join('');

  const total = currentTime || 1;
  get('statsGrid').innerHTML = `
    <div class="stat-item"><div class="stat-label">Total Time</div><div class="stat-value">${total}</div></div>
    <div class="stat-item"><div class="stat-label">CPU Utilization</div><div class="stat-value">${((total - cpuIdleTime) / total * 100).toFixed(1)}%</div></div>
    <div class="stat-item"><div class="stat-label">Throughput</div><div class="stat-value">${(valid.length / total).toFixed(3)}</div></div>
    <div class="stat-item"><div class="stat-label">Context Switches</div><div class="stat-value">${contextSwitches}</div></div>
    <div class="stat-item"><div class="stat-label">Total Idle Time</div><div class="stat-value">${cpuIdleTime}</div></div>
  `;
}

function exportScreenshot() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
  modal.innerHTML = `
    <div style="background:white;padding:30px;border-radius:12px;max-width:500px;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 20px;text-align:center;color:#0369a1;">Export Screenshot</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <button id="expGantt" class="btn" style="background:#0284c7;color:white;">Gantt Chart</button>
        <button id="expTable" class="btn" style="background:#059669;color:white;">Process Table</button>
        <button id="expResults" class="btn" style="background:#7c3aed;color:white;">Results & Stats</button>
        <button id="closeModal" class="btn" style="background:#64748b;color:white;margin-top:8px;">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  get('expGantt').onclick = () => { modal.remove(); capture('.gantt-section', 'gantt'); };
  get('expTable').onclick = () => { modal.remove(); capture('#processInputs', 'process-table'); };
  get('expResults').onclick = () => {
    modal.remove();
    const temp = document.createElement('div');
    temp.style.cssText = 'background:#f8fafc;padding:20px;';
    temp.appendChild(get('resultsSection').cloneNode(true));
    temp.appendChild(get('detailedStats').cloneNode(true));
    document.body.appendChild(temp);
    html2canvas(temp, {scale:2, backgroundColor:'#f8fafc'}).then(c => {
      document.body.removeChild(temp);
      downloadCanvas(c, 'results');
    });
  };
  get('closeModal').onclick = () => modal.remove();
  modal.onclick = e => e.target === modal && modal.remove();
}

function capture(selector, name) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!el) return alert('Section not found');
  html2canvas(el, {scale:2, backgroundColor:'#ffffff'}).then(c => downloadCanvas(c, name));
}

function downloadCanvas(canvas, name) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${name}-${Date.now()}.png`;
  a.click();
}

function enableExports(on) {
  get('exportScreenshotBtn').disabled = !on && get('processInputs').innerHTML.trim() === '';
}

function resetSimulation() {
  if (isPlaying) togglePlayPause();
  currentTime = 0; readyQueue = []; ioQueue = []; ganttChart = [];
  currentExecuting = null; history = []; historyIndex = -1;
  executionTrace = []; contextSwitches = 0; cpuIdleTime = 0;
  isInContextSwitch = false; contextSwitchEndTime = 0; cpuWasIdle = true;
  lastExecutedProcess = null;
  get('resultsSection').style.display = 'none';
  get('detailedStats').style.display = 'none';
  updateDisplay();
  enableExports(false);
}

get('speedSlider').addEventListener('input', function () {
  animationMultiplier = parseFloat(this.value);
  get('speedValue').textContent = animationMultiplier.toFixed(2) + 'x';
  if (isPlaying) {
    clearInterval(intervalId);
    intervalId = setInterval(stepExecution, Math.max(20, Math.round(baseDelay / animationMultiplier)));
  }
});

window.onload = () => {
  updateBurstCountVisibility();
  get('startBtn').onclick = startSimulation;
  get('playPauseBtn').onclick = togglePlayPause;
  get('stepBtn').onclick = stepExecution;
  get('prevBtn').onclick = previousStep;
  get('resetBtn').onclick = resetSimulation;
  get('exportScreenshotBtn').onclick = exportScreenshot;
};
