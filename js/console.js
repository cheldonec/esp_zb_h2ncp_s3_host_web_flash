// js/console.js
const decoder = new TextDecoder();
const MAX_LINES = 5000;

// ANSI цвета → классы
const ANSI_COLORS = {
  '0;31': 'E',     // ERROR
  '0;32': 'I',     // INFO
  '0;33': 'W',     // WARN
  '0;36': 'boot',  // Boot
  '1;31': 'E',
  '1;32': 'I',
  '1;33': 'W',
};

// Общее состояние для консолей
const conState = {
  s3: { port: null, reader: null, running: false, paused: false, lines: 0, bytes: 0 },
  h2: { port: null, reader: null, running: false, paused: false, lines: 0, bytes: 0 },
};

/**
 * Добавляет текст в консоль с поддержкой ANSI-цветов
 */
function conAppend(chip, text) {
  const state = conState[chip];
  if (state.paused) return;

  const el = document.getElementById(`conOutput${ucChip(chip)}`);
  if (!el) return;

  const parts = text.split(/\033\[([0-9;]+)m/);
  let currentClass = '';

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const code = parts[i];
      if (code === '0') currentClass = '';
      else currentClass = ANSI_COLORS[code] || '';
      continue;
    }
    const chunk = parts[i];
    if (!chunk) continue;

    const span = document.createElement('span');
    if (currentClass) span.className = currentClass;
    span.textContent = chunk;
    el.appendChild(span);

    state.lines += (chunk.match(/\n/g) || []).length;
  }

  // Очищаем старые строки безопасно
  try {
    while (state.lines > MAX_LINES && el.firstChild) {
      const first = el.firstChild;
      if (!first) {
        state.lines--;
      } else {
        state.lines -= (first.textContent?.match(/\n/g) || []).length;
        el.removeChild(first);
      }
    }
  } catch (e) {}

  // Прокрутка вниз
  try {
    el.scrollTop = el.scrollHeight;
  } catch (e) {}
}

/**
 * Цикл чтения данных из последовательного порта
 */
async function conReadLoop(chip) {
    console.log('✅ conReadLoop started for', chip);
  const state = conState[chip];
  const outputEl = document.getElementById(`conOutput${ucChip(chip)}`);
  const statsEl = document.getElementById(`conStats${ucChip(chip)}`);

  if (!outputEl || !statsEl) {
    state.running = false;
    return;
  }

  while (state.running && state.port && state.port.readable) {
    try {
      state.reader = state.port.readable.getReader();
      while (state.running) {
        const { value, done } = await state.reader.read();
        if (done) break;

        if (value) {
          state.bytes += value.length;
          console.log('Received raw data:', value);
          const decoded = decoder.decode(value, { stream: true });
          conAppend(chip, decoded);

          if (statsEl) {
            statsEl.textContent = `${state.lines} lines / ${(state.bytes / 1024).toFixed(1)} KB`;
          }
        }
      }
    } catch (e) {
      if (state.running) {
        conAppend(chip, `\n[Serial error: ${e.message}]\n`);
      }
    } finally {
      try {
        if (state.reader) {
          state.reader.releaseLock();
        }
      } catch (e) {}
      state.reader = null;
    }
  }
}

/**
 * Открытие консоли — теперь запоминает порт
 */
window.conOpen = async function(chip) {
  try {
    const baud = parseInt(document.getElementById(`conBaud${ucChip(chip)}`).value, 10);
    let port = conState[chip].port;

    // Если порт ещё не выбран — запросить у пользователя
    if (!port) {
      try {
        // 🔓 УБРАН ФИЛЬТР — пользователь видит ВСЕ порты
        port = await navigator.serial.requestPort();
        conState[chip].port = port;
      } catch (e) {
        conAppend(chip, `[Open failed: ${e.message}]\n`);
        return;
      }
    }

    // Если порт уже открыт — закрыть перед повторным открытием
    if (port.readable || port.writable) {
      try {
        await port.close();
      } catch (e) {}
    }

    await port.open({ baudRate: baud });

    conState[chip].running = true;
    conState[chip].paused = false;

    // UI обновления
    document.getElementById(`btnConOpen${ucChip(chip)}`).style.display = 'none';
    document.getElementById(`btnConClose${ucChip(chip)}`).style.display = '';
    document.getElementById(`conBaud${ucChip(chip)}`).disabled = true;
    document.getElementById(`conStatus${ucChip(chip)}`).innerHTML =
      `<span class="dot on"></span>Connected (${baud} baud)`;

    // Аппаратный сброс через RTS
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await new Promise(r => setTimeout(r, 100));
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      conAppend(chip, `[Console ${chip.toUpperCase()} opened at ${baud} baud]\n`);
    } catch (e) {
      conAppend(chip, `[Reset failed: ${e.message}]\n`);
    }

    // Запуск цикла чтения
    conReadLoop(chip);
  } catch (e) {
    conAppend(chip, `[Open failed: ${e.message}]\n`);
  }
};

/**
 * Закрытие консоли
 */
window.conClose = async function(chip) {
  const state = conState[chip];
  state.running = false;

  try {
    if (state.reader) {
      await state.reader.cancel();
    }
  } catch (e) {}

  try {
    if (state.port) {
      await state.port.close();
    }
  } catch (e) {}

  state.port = null;
  state.reader = null;

  // UI обновления
  document.getElementById(`btnConOpen${ucChip(chip)}`).style.display = '';
  document.getElementById(`btnConClose${ucChip(chip)}`).style.display = 'none';
  document.getElementById(`conBaud${ucChip(chip)}`).disabled = false;
  document.getElementById(`conStatus${ucChip(chip)}`).innerHTML = '<span class="dot off"></span>Closed';
  conAppend(chip, '[Console closed]\n');
};

/**
 * Очистка консоли
 */
window.conClear = function(chip) {
  const el = document.getElementById(`conOutput${ucChip(chip)}`);
  if (!el) return;
  el.textContent = '';
  conState[chip].lines = 0;
  conState[chip].bytes = 0;
  const statsEl = document.getElementById(`conStats${ucChip(chip)}`);
  if (statsEl) statsEl.textContent = '';
};

/**
 * Сохранение лога в файл
 */
window.conSaveLog = function(chip) {
  const el = document.getElementById(`conOutput${ucChip(chip)}`);
  if (!el || !el.textContent.trim()) return;

  const blob = new Blob([el.innerText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `esp-console-${chip}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Пауза/возобновление вывода
 */
window.conTogglePause = function(chip) {
  const state = conState[chip];
  state.paused = !state.paused;
  const btn = document.getElementById(`btnConPause${ucChip(chip)}`);
  if (btn) {
    btn.textContent = state.paused ? 'Resume' : 'Pause';
  }
  if (state.paused) {
    conAppend(chip, '\n[Paused]\n');
  }
};

// Утилита
function ucChip(c) {
  return c.toUpperCase();
}
window.conState = conState;