// 習慣トラッカーの計算とデータ処理（画面とは無関係な部分）
// 日付はすべて "YYYY-MM-DD" の文字列で扱う。

export const STORAGE_KEY = 'habit-tracker-data';
export const DATA_VERSION = 1;
export const MAX_NAME_LENGTH = 30;

// ---------- 日付の道具 ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date（端末の時刻）→ "YYYY-MM-DD"
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// "YYYY-MM-DD" に n 日足す（マイナスも可）
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------- データの形 ----------

export function createEmptyData() {
  return { app: 'habit-tracker', version: DATA_VERSION, exportedAt: null, habits: [] };
}

function normalizeName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function uniqueSortedDates(dates) {
  return [...new Set(dates.filter(isDateKey))].sort();
}

// 名前を確かめて、前後の空白を取った名前を返す。
// exceptId の習慣は「同じ名前」の確認から外す（名前変更で自分と比べないため）。
function validateName(data, name, exceptId = null) {
  const clean = normalizeName(name);
  if (!clean) throw new Error('習慣の名前を入力してください');
  if (clean.length > MAX_NAME_LENGTH) {
    throw new Error(`名前は${MAX_NAME_LENGTH}文字以内にしてください`);
  }
  if (data.habits.some((h) => h.id !== exceptId && h.name === clean)) {
    throw new Error('同じ名前の習慣がすでにあります');
  }
  return clean;
}

function findHabit(data, habitId) {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) throw new Error('習慣が見つかりません');
  return habit;
}

// 習慣を追加する。元のデータは変えず、新しいデータを返す。
export function addHabit(data, name, today, id = makeId()) {
  const clean = validateName(data, name);
  const habit = { id, name: clean, createdAt: today, doneDates: [] };
  return { ...data, habits: [...data.habits, habit] };
}

// 名前を変える。記録はそのまま残る。
export function renameHabit(data, habitId, name) {
  findHabit(data, habitId);
  const clean = validateName(data, name, habitId);
  return { ...data, habits: data.habits.map((h) => (h.id === habitId ? { ...h, name: clean } : h)) };
}

// 習慣を記録ごと消す。
export function deleteHabit(data, habitId) {
  findHabit(data, habitId);
  return { ...data, habits: data.habits.filter((h) => h.id !== habitId) };
}

export function makeId() {
  return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function isDone(habit, date) {
  return habit.doneDates.includes(date);
}

// その日の「できた」を付けたり外したりする
export function toggleDone(data, habitId, date) {
  if (!isDateKey(date)) throw new Error('日付の形が正しくありません');
  let found = false;
  const habits = data.habits.map((h) => {
    if (h.id !== habitId) return h;
    found = true;
    const doneDates = isDone(h, date)
      ? h.doneDates.filter((d) => d !== date)
      : uniqueSortedDates([...h.doneDates, date]);
    return { ...h, doneDates };
  });
  if (!found) throw new Error('習慣が見つかりません');
  return { ...data, habits };
}

// ---------- 連続日数 ----------

// 今日までの連続日数。
// 今日がまだ未チェックでも、昨日まで続いていれば途切れ扱いにしない。
export function currentStreak(habit, today) {
  const done = new Set(habit.doneDates);
  let day = done.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (done.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

// ---------- 今月の記録 ----------

// 指定した月の1日ずつの記録を返す。
// status: "done"（できた） / "missed"（できなかった） / "today"（今日・未チェック）
//         / "future"（これから） / "before"（習慣を作る前）
export function monthRecord(habit, year, month, today) {
  const done = new Set(habit.doneDates);
  const total = daysInMonth(year, month);
  const days = [];
  let doneCount = 0;
  for (let d = 1; d <= total; d += 1) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    let status;
    if (done.has(date)) {
      status = 'done';
      doneCount += 1;
    } else if (date > today) {
      status = 'future';
    } else if (date === today) {
      status = 'today';
    } else if (habit.createdAt && date < habit.createdAt) {
      status = 'before';
    } else {
      status = 'missed';
    }
    days.push({ date, day: d, status });
  }
  // 1日が何曜日か（0=日曜）。カレンダーの空きマスに使う。
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return { year, month, firstWeekday, days, doneCount };
}

// ---------- 保存と読み込み ----------

// JSON の文字列を読み、正しい形のデータにして返す。壊れていたらエラー。
export function parseData(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('データを読み取れませんでした');
  }
  if (!raw || typeof raw !== 'object' || raw.version !== DATA_VERSION || !Array.isArray(raw.habits)) {
    throw new Error('対応していないデータの形です');
  }
  const habits = [];
  const seenIds = new Set();
  for (const h of raw.habits) {
    const name = normalizeName(h && h.name);
    if (!name || typeof h.id !== 'string' || seenIds.has(h.id)) continue;
    seenIds.add(h.id);
    habits.push({
      id: h.id,
      name: name.slice(0, MAX_NAME_LENGTH),
      createdAt: isDateKey(h.createdAt) ? h.createdAt : null,
      doneDates: Array.isArray(h.doneDates) ? uniqueSortedDates(h.doneDates) : [],
    });
  }
  return { ...createEmptyData(), exportedAt: raw.exportedAt ?? null, habits };
}

// 書き出し用の JSON 文字列を作る。now は書き出した日時。
export function exportData(data, now = new Date()) {
  return JSON.stringify({ ...data, version: DATA_VERSION, exportedAt: now.toISOString() }, null, 2);
}

export function backupFileName(today) {
  return `habit-tracker-backup-${today}.json`;
}

// 確認画面に出す「習慣◯個・記録◯日分」
export function summarize(data) {
  return {
    habitCount: data.habits.length,
    recordCount: data.habits.reduce((sum, h) => sum + h.doneDates.length, 0),
  };
}

// storage には localStorage を渡す（テストでは代わりの物を渡す）
export function loadData(storage) {
  const text = storage.getItem(STORAGE_KEY);
  if (text === null) return createEmptyData();
  try {
    return parseData(text);
  } catch {
    // 壊れたデータは上書きで消えないよう、別の名前で残しておく
    storage.setItem(STORAGE_KEY + '-broken', text);
    return createEmptyData();
  }
}

export function saveData(storage, data) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}
