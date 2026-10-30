// 画面の動き。計算やデータ処理は habits.js に任せる。
import {
  toDateKey, addHabit, toggleDone, isDone,
  currentStreak, monthRecord, loadData, saveData, createEmptyData,
  exportData, backupFileName, summarize, parseData, STORAGE_KEY,
  renameHabit, deleteHabit, MAX_NAME_LENGTH,
} from './habits.js';

const MAX_IMPORT_BYTES = 1024 * 1024; // 1MB より大きいファイルは読まない

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const $ = (id) => document.getElementById(id);
const els = {
  todayLabel: $('today-label'),
  form: $('add-form'),
  input: $('habit-name'),
  message: $('message'),
  empty: $('empty'),
  list: $('habit-list'),
  exportBtn: $('export-btn'),
  importBtn: $('import-btn'),
  importFile: $('import-file'),
  dataMessage: $('data-message'),
};

// localStorage が使えない環境（一部のプライベートモード等）でも落ちないように
function getStorage() {
  try {
    const s = window.localStorage;
    const k = '__test__';
    s.setItem(k, k);
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

const storage = getStorage();
let data = storage ? loadData(storage) : createEmptyData();
let today = toDateKey(new Date());
let editingId = null; // 編集中の習慣（なければ null）

// ok=true なら緑（うまくいった）、false なら赤（注意）
// target を省くと、上の入力欄の下に出す
function showMessage(text, ok = false, target = els.message) {
  target.textContent = text;
  target.classList.toggle('ok', ok);
}
const showDataMessage = (text, ok = false) => showMessage(text, ok, els.dataMessage);

function persist(next) {
  data = next;
  if (!storage) {
    showMessage('この端末では保存できません。閉じると記録が消えます。');
    return;
  }
  try {
    saveData(storage, data);
  } catch {
    showMessage('保存に失敗しました。端末の空き容量を確かめてください。');
  }
}

function formatToday(key) {
  const [y, m, d] = key.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${w}）`;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

function renderCalendar(habit) {
  const [y, m] = today.split('-').map(Number);
  const rec = monthRecord(habit, y, m, today);
  const grid = el('div', { className: 'calendar-grid' });

  WEEKDAYS.forEach((w, i) => {
    const cls = i === 0 ? ' sun' : i === 6 ? ' sat' : '';
    grid.append(el('div', { className: 'weekday' + cls, textContent: w, ariaHidden: 'true' }));
  });
  for (let i = 0; i < rec.firstWeekday; i += 1) grid.append(el('div'));

  for (const day of rec.days) {
    const label = `${m}月${day.day}日`;
    const canTap = day.status !== 'future' && day.status !== 'before';
    const cell = el(canTap ? 'button' : 'div', {
      className: `day ${day.status}${day.date === today ? ' today' : ''}`,
      textContent: String(day.day),
    });
    if (canTap) {
      cell.type = 'button';
      cell.dataset.action = 'toggle';
      cell.dataset.habit = habit.id;
      cell.dataset.date = day.date;
      cell.setAttribute('aria-pressed', String(day.status === 'done'));
      cell.setAttribute('aria-label', `${label} ${day.status === 'done' ? 'できた' : '未チェック'}`);
    } else {
      cell.setAttribute('aria-label', label);
    }
    grid.append(cell);
  }

  return el('div', { className: 'calendar' }, [
    el('p', { className: 'calendar-title', textContent: `${m}月の記録（できた日：${rec.doneCount}日）` }),
    grid,
    renderLegend(),
  ]);
}

// 色の説明（凡例）
function renderLegend() {
  const item = (cls, text) =>
    el('li', {}, [el('span', { className: `swatch ${cls}`, ariaHidden: 'true' }), text]);
  return el('ul', { className: 'legend' }, [
    item('done', 'できた'),
    item('missed', 'できなかった'),
    item('today', '今日'),
  ]);
}

function renderHabit(habit) {
  const done = isDone(habit, today);
  const streak = currentStreak(habit, today);

  const stats = el('p', { className: 'habit-stats' });
  if (streak > 0) {
    stats.append(el('span', { className: 'streak', textContent: `🔥 ${streak}日連続` }));
  } else {
    stats.textContent = '今日から始めましょう';
  }

  const btn = el('button', {
    type: 'button',
    className: 'check-btn',
    textContent: done ? '✓ できた' : '今日やった',
  });
  btn.dataset.action = 'toggle';
  btn.dataset.habit = habit.id;
  btn.dataset.date = today;
  btn.setAttribute('aria-pressed', String(done));
  btn.setAttribute('aria-label', `${habit.name}：今日 ${done ? 'できた（押すと取り消し）' : 'まだ'}`);

  const editBtn = actionButton('edit', habit.id, '編集', 'edit-btn');
  editBtn.setAttribute('aria-label', `${habit.name}を編集`);

  const top = editingId === habit.id
    ? renderEditForm(habit)
    : el('div', { className: 'habit-top' }, [
      el('div', { className: 'habit-info' }, [
        el('div', { className: 'habit-title' }, [
          el('h2', { className: 'habit-name', textContent: habit.name }),
          editBtn,
        ]),
        stats,
      ]),
      btn,
    ]);

  return el('li', { className: 'habit' }, [top, renderCalendar(habit)]);
}

function actionButton(action, habitId, text, className) {
  const b = el('button', { type: 'button', className, textContent: text });
  b.dataset.action = action;
  b.dataset.habit = habitId;
  return b;
}

// 名前の変更と削除の欄
function renderEditForm(habit) {
  const input = el('input', {
    type: 'text',
    name: 'name',
    value: habit.name,
    maxLength: MAX_NAME_LENGTH,
    className: 'edit-input',
    enterKeyHint: 'done',
  });
  input.setAttribute('aria-label', '新しい名前');
  const form = el('form', { className: 'edit-form' }, [
    input,
    el('p', { className: 'message edit-message', role: 'status' }),
    el('div', { className: 'edit-buttons' }, [
      el('button', { type: 'submit', className: 'save-btn', textContent: '保存' }),
      actionButton('cancel', habit.id, 'やめる', 'cancel-btn'),
      actionButton('delete', habit.id, '削除', 'delete-btn'),
    ]),
  ]);
  form.dataset.habit = habit.id;
  return form;
}

function render() {
  els.todayLabel.textContent = formatToday(today);
  els.empty.hidden = data.habits.length > 0;
  els.list.replaceChildren(...data.habits.map(renderHabit));
}

// ---------- 操作 ----------

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    persist(addHabit(data, els.input.value, today));
    els.input.value = '';
    showMessage('');
    render();
  } catch (err) {
    showMessage(err.message);
  }
});

function startEditing(habitId) {
  editingId = habitId;
  render();
  const input = els.list.querySelector('.edit-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function stopEditing() {
  const id = editingId;
  editingId = null;
  render();
  // 編集ボタンに戻す（キーボード操作で迷子にならないように）
  els.list.querySelector(`.edit-btn[data-habit="${CSS.escape(id ?? '')}"]`)?.focus();
}

// 習慣カードの中のボタンは、ここでまとめて受け取る
els.list.addEventListener('click', (e) => {
  const target = e.target.closest('button[data-action]');
  if (!target) return;
  const id = target.dataset.habit;
  try {
    switch (target.dataset.action) {
      case 'toggle': // チェックボタンとカレンダーのマス
        persist(toggleDone(data, id, target.dataset.date));
        render();
        break;
      case 'edit':
        startEditing(id);
        break;
      case 'cancel':
        stopEditing();
        break;
      case 'delete': {
        const habit = data.habits.find((h) => h.id === id);
        const ok = window.confirm(
          `「${habit.name}」を削除します。\n` +
          `記録（${habit.doneDates.length}日分）も一緒に消え、元に戻せません。よろしいですか？`,
        );
        if (!ok) return;
        persist(deleteHabit(data, id));
        editingId = null;
        render();
        showMessage(`「${habit.name}」を削除しました`, true);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    showMessage(err.message);
  }
});

// 名前の保存
els.list.addEventListener('submit', (e) => {
  const form = e.target.closest('.edit-form');
  if (!form) return;
  e.preventDefault();
  try {
    persist(renameHabit(data, form.dataset.habit, form.elements.name.value));
    stopEditing();
  } catch (err) {
    form.querySelector('.edit-message').textContent = err.message;
  }
});

// Esc キーで編集をやめる
els.list.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editingId) stopEditing();
});

// ---------- 書き出し・読み込み ----------

els.exportBtn.addEventListener('click', () => {
  if (data.habits.length === 0) {
    showDataMessage('書き出す習慣がまだありません');
    return;
  }
  const blob = new Blob([exportData(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: backupFileName(today) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showDataMessage('書き出しました。ダウンロードしたファイルを保管してください。', true);
});

els.importBtn.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  els.importFile.value = ''; // 同じファイルをもう一度選べるように
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showDataMessage('ファイルが大きすぎます（1MBまで）');
    return;
  }
  let incoming;
  try {
    incoming = parseData(await file.text());
  } catch (err) {
    showDataMessage(`読み込めませんでした：${err.message}`);
    return;
  }
  const next = summarize(incoming);
  const now = summarize(data);
  const ok = window.confirm(
    `「${file.name}」を読み込みます。\n` +
    `読み込む内容：習慣${next.habitCount}個・記録${next.recordCount}日分\n` +
    `今の記録（習慣${now.habitCount}個・記録${now.recordCount}日分）と置き換えます。よろしいですか？`,
  );
  if (!ok) return;
  // 念のため、置き換える前の記録を1つだけ残しておく
  if (storage && data.habits.length > 0) {
    try {
      storage.setItem(STORAGE_KEY + '-before-import', JSON.stringify(data));
    } catch {
      // 残せなくても読み込みは続ける
    }
  }
  persist({ ...incoming, exportedAt: null });
  editingId = null;
  render();
  showDataMessage(`読み込みました（習慣${next.habitCount}個）`, true);
});

// 日付が変わったら表示を更新する（アプリを開きっぱなしの場合など）
function refreshIfNewDay() {
  const now = toDateKey(new Date());
  if (now !== today) {
    today = now;
    render();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshIfNewDay();
});
setInterval(refreshIfNewDay, 60 * 1000);

render();

// ---------- オフライン対応 ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 登録に失敗してもアプリ自体は使える
  });
}
