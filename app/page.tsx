'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, X } from 'lucide-react';
import { Button, Card, Input, Label, MetricCard, SidebarItem } from './components/ui';
import { trackEvent } from './lib/analytics';

type Box = {
  id: string;
  title: string;
  duration: number;
  time: string;
};

type MorningRitual = {
  primaryGoal: string;
  deepWorkStart: string;
  deepWorkEnd: string;
  blockedItems: string[];
  skipped?: boolean;
};

type CompletedBox = {
  boxId: string;
  boxTitle: string;
  plannedDuration: number;
  actualDuration: number;
  actualDurationSeconds?: number;
  pauseDuration: number;
  startedAt: string;
  finishedAt: string;
  date: string;
};

type Note = {
  boxId: string;
  boxTitle: string;
  note: string;
  finishedAt: string;
};

type ScheduleGap = {
  start: string;
  end: string;
  duration: number;
};

const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const ACTIVE_SESSION_KEY = 'tibo-active-session';
const LATEST_NEXT_STEP_KEY = 'tibo-next-step-latest';
const NEXT_STEP_HISTORY_KEY = 'tibo-next-step-history';
const FEEDBACK_URL = process.env.NEXT_PUBLIC_FEEDBACK_URL?.trim();

function getTodayLabel(): string {
  const today = new Date();
  return `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()} ${DAYS[today.getDay()]}`;
}

function getTodayStamp(): string {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}-${month}-${year}`;
}

function getLegacyTodayStamp(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayStamp(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function getBoxesStorageKey(): string {
  return `tibo-boxes-${getTodayStamp()}`;
}

function getLegacyBoxesStorageKey(): string {
  return `tibo-boxes-${getLegacyTodayStamp()}`;
}

function getMorningRitualStorageKey(): string {
  return `tibo-toren-${getTodayStamp()}`;
}

function getLegacyMorningRitualStorageKey(): string {
  return `tibo-toren-${getLegacyTodayStamp()}`;
}

function normalizeMorningRitual(data: Partial<MorningRitual> & Record<string, unknown>): MorningRitual {
  const current = data as MorningRitual;

  return {
    primaryGoal: current.primaryGoal ?? String(data['tekGorev'] ?? ''),
    deepWorkStart: current.deepWorkStart ?? String(data['deepWorkBaslangic'] ?? '09:00'),
    deepWorkEnd: current.deepWorkEnd ?? String(data['deepWorkBitis'] ?? '11:00'),
    blockedItems: current.blockedItems ?? (Array.isArray(data['yasaklilar']) ? data['yasaklilar'] as string[] : []),
    skipped: current.skipped ?? Boolean(data['atlandi']),
  };
}

function normalizeTaskTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) return `${hours}s ${remainingMinutes}dk`;
  if (hours > 0) return `${hours}s`;
  if (remainingMinutes > 0) return `${remainingMinutes}dk`;
  return '0dk';
}

function isCriticalVariance(plannedMinutes: number, actualMinutes: number): boolean {
  if (plannedMinutes <= 0 || actualMinutes <= 0) return false;
  const delta = Math.abs(actualMinutes - plannedMinutes);
  return delta >= 10 || delta / plannedMinutes > 0.2;
}

function roundUpToFive(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`;
}

function getCurrentTimeValue(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTaskCommand(input: string): { title: string; durationFromCommand: number | null } {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  const match = trimmed.match(/^(.*\S)\s+(\d{1,3})$/);
  if (!match) return { title: trimmed, durationFromCommand: null };

  const parsedDuration = Number(match[2]);
  if (parsedDuration < 1 || parsedDuration > 600) {
    return { title: trimmed, durationFromCommand: null };
  }

  return {
    title: match[1].trim(),
    durationFromCommand: parsedDuration,
  };
}

function isVagueTaskTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  const genericWords = new Set([
    'work',
    'study',
    'çalış',
    'ders',
    'iş',
  ]);
  return genericWords.has(normalized);
}

function findScheduleGaps(sortedBoxes: Box[]): ScheduleGap[] {
  const gaps: ScheduleGap[] = [];

  for (let index = 0; index < sortedBoxes.length - 1; index += 1) {
    const currentBox = sortedBoxes[index];
    const nextBox = sortedBoxes[index + 1];
    const currentEndsAt = parseTimeToMinutes(currentBox.time) + currentBox.duration;
    const nextStartsAt = parseTimeToMinutes(nextBox.time);
    const gapDuration = nextStartsAt - currentEndsAt;

    if (gapDuration >= 30) {
      gaps.push({
        start: formatClock(currentEndsAt),
        end: nextBox.time,
        duration: gapDuration,
      });
    }
  }

  return gaps;
}

function readAllCompletedBoxes(): CompletedBox[] {
  try {
    const completedBoxes: CompletedBox[] = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('tibo-completed-')) continue;
      try {
        const value = localStorage.getItem(key);
        if (value) {
          completedBoxes.push(...(JSON.parse(value) as CompletedBox[]));
        }
      } catch {
        // Skip malformed completed records.
      }
    }
    return completedBoxes;
  } catch {
    return [];
  }
}

function isAllowedBackupKey(key: string): boolean {
  return key.startsWith('tibo-');
}

function readLatestResumeNotes(): string[] {
  try {
    const allNotes: Note[] = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('tibo-notes-')) continue;
      const value = localStorage.getItem(key);
      if (!value) continue;
      try {
        const parsed = JSON.parse(value) as Note[];
        allNotes.push(...parsed.filter((note) => note.note.trim().length > 0));
      } catch {
        // skip malformed note groups
      }
    }
    return allNotes
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
      .map((note) => note.note.trim())
      .filter((note) => note.length > 0);
  } catch {
    return [];
  }
}

type NextStepRecord = {
  date: string;
  text: string;
};

function readNextStepPrefill(): string {
  try {
    const latestValue = localStorage.getItem(LATEST_NEXT_STEP_KEY);
    if (latestValue && latestValue.trim().length > 0) {
      return latestValue.trim().slice(0, 120);
    }
  } catch {
    // no-op
  }
  return '';
}

function readNextStepHistory(): NextStepRecord[] {
  try {
    const raw = localStorage.getItem(NEXT_STEP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NextStepRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.date === 'string' && typeof item.text === 'string')
      .filter((item) => item.text.trim().length > 0)
      .slice(-20);
  } catch {
    return [];
  }
}

function isValidCompletedBox(completedBox: CompletedBox): boolean {
  const actualSeconds = completedBox.actualDurationSeconds ?? completedBox.actualDuration * 60;
  return Boolean(
    completedBox &&
    typeof completedBox.boxId === 'string' &&
    completedBox.boxId.trim().length > 0 &&
    typeof completedBox.boxTitle === 'string' &&
    completedBox.boxTitle.trim().length > 0 &&
    Number.isFinite(completedBox.plannedDuration) &&
    completedBox.plannedDuration > 0 &&
    Number.isFinite(actualSeconds) &&
    actualSeconds > 0,
  );
}

export default function HomePage() {
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [duration, setDuration] = useState('30');
  const [time] = useState('');
  const [formError, setFormError] = useState('');
  const [taskShake, setTaskShake] = useState(false);
  const [morningRitual, setMorningRitual] = useState<MorningRitual | null>(null);
  const [completedHistory, setCompletedHistory] = useState<CompletedBox[]>([]);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [hasActiveSessionLock, setHasActiveSessionLock] = useState(false);
  const [continuationWarning, setContinuationWarning] = useState('');

  useEffect(() => {
    const hasActiveSession = localStorage.getItem(ACTIVE_SESSION_KEY) === '1';
    setHasActiveSessionLock(hasActiveSession);
    if (hasActiveSession) {
      router.push('/focus');
      return;
    }

    const ritualRecord =
      localStorage.getItem(getMorningRitualStorageKey()) ??
      localStorage.getItem(getLegacyMorningRitualStorageKey());

    if (ritualRecord) {
      try {
        const parsed = normalizeMorningRitual(JSON.parse(ritualRecord));
        if (!parsed.skipped && parsed.primaryGoal) {
          setMorningRitual(parsed);
        }
      } catch {
        // Ignore malformed ritual records.
      }
    }

    const savedBoxes =
      localStorage.getItem(getBoxesStorageKey()) ??
      localStorage.getItem(getLegacyBoxesStorageKey());
    if (savedBoxes) {
      try {
        setBoxes(JSON.parse(savedBoxes));
      } catch {
        setBoxes([]);
      }
    }
    const nextStepPrefill = readNextStepPrefill();
    const resumeNotes = readLatestResumeNotes();
    const initialTask = nextStepPrefill || (resumeNotes[0] ? resumeNotes[0].slice(0, 120) : '');
    if (initialTask) {
      setTaskTitle(initialTask);
    }

    const history = readNextStepHistory();
    if (history.length >= 2) {
      const latest = normalizeTaskTitle(history[history.length - 1].text);
      const previous = normalizeTaskTitle(history[history.length - 2].text);
      if (latest.length >= 3 && latest === previous) {
        setContinuationWarning('İlerleme yok.');
      } else {
        setContinuationWarning('');
      }
    } else if (resumeNotes.length >= 2) {
      const latest = normalizeTaskTitle(resumeNotes[0]);
      const previous = normalizeTaskTitle(resumeNotes[1]);
      if (latest.length >= 3 && latest === previous) {
        setContinuationWarning('İlerleme yok.');
      } else {
        setContinuationWarning('');
      }
    } else {
      setContinuationWarning('');
    }
    setCompletedHistory(readAllCompletedBoxes());

    try {
      const yesterdayCompleted = localStorage.getItem(`tibo-completed-${getYesterdayStamp()}`);
      const alreadyTracked = localStorage.getItem(`tibo-return-tracked-${getTodayStamp()}`);
      if (yesterdayCompleted && !alreadyTracked) {
        const parsed = JSON.parse(yesterdayCompleted) as CompletedBox[];
        if (Array.isArray(parsed) && parsed.some((item) => isValidCompletedBox(item))) {
          trackEvent('return_next_day', { from: getYesterdayStamp(), to: getTodayStamp() });
          localStorage.setItem(`tibo-return-tracked-${getTodayStamp()}`, '1');
        }
      }
    } catch {
      // ignore malformed carry-over tracking
    }

    setIsLoaded(true);
  }, [router]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(getBoxesStorageKey(), JSON.stringify(boxes));
  }, [boxes, isLoaded]);

  function triggerTaskShake() {
    setTaskShake(false);
    window.requestAnimationFrame(() => {
      setTaskShake(true);
      window.setTimeout(() => setTaskShake(false), 360);
    });
  }

  function validateTaskInput(rawTask: string, rawDuration: string): string | null {
    const parsedTask = parseTaskCommand(rawTask);
    const title = parsedTask.title.trim();
    const selectedDuration = parsedTask.durationFromCommand ?? Number(rawDuration);

    if (!title) return 'Önce görevi tanımla.';
    if (title.length < 3) return 'Önce görevi tanımla.';
    if (isVagueTaskTitle(title)) return 'Önce görevi tanımla.';
    if (!Number.isFinite(selectedDuration) || selectedDuration <= 0) return 'Önce süreyi seç.';
    return null;
  }

  function buildBoxFromForm(): Box | null {
    const parsedTask = parseTaskCommand(taskTitle);
    const title = parsedTask.title;
    if (!title) return null;

    const selectedDuration = parsedTask.durationFromCommand ?? Number(duration || 30);
    const safeDuration = Number.isFinite(selectedDuration) && selectedDuration > 0
      ? selectedDuration
      : 30;

    return {
      id: Date.now().toString(),
      title,
      duration: compressedDuration ?? safeDuration,
      time: time || getCurrentTimeValue(),
    };
  }

  function addBox() {
    if (hasActiveSessionLock) {
      setFormError('Önce bunu bitir.');
      triggerTaskShake();
      return;
    }
    const validationError = validateTaskInput(taskTitle, duration);
    if (validationError) {
      setFormError(validationError);
      triggerTaskShake();
      return;
    }
    const newBox = buildBoxFromForm();
    if (!newBox) {
      setFormError('Önce görevi tanımla.');
      triggerTaskShake();
      return;
    }
    setFormError('');
    setBoxes((previousBoxes) => [...previousBoxes, newBox]);
    setTaskTitle('');
    setDuration('30');
  }

  function startFocus() {
    if (hasActiveSessionLock) {
      setFormError('Önce bunu bitir.');
      triggerTaskShake();
      return;
    }
    const validationError = validateTaskInput(taskTitle, duration);
    if (validationError) {
      setFormError(validationError);
      triggerTaskShake();
      return;
    }

    const newBox = buildBoxFromForm();
    if (!newBox) {
      if (boxes.length > 0) {
        router.push('/focus');
        return;
      }
      setFormError('Önce görevi tanımla.');
      triggerTaskShake();
      return;
    }

    const nextBoxes = [...boxes, newBox];
    setFormError('');
    setBoxes(nextBoxes);
    localStorage.setItem(getBoxesStorageKey(), JSON.stringify(nextBoxes));
    trackEvent('first_task_started', {
      plannedCount: nextBoxes.length,
      duration: newBox.duration,
    });
    router.push('/focus');
  }

  function deleteBox(id: string) {
    if (hasActiveSessionLock) {
      setFormError('Önce bunu bitir.');
      return;
    }
    setBoxes((previousBoxes) => previousBoxes.filter((box) => box.id !== id));
  }

  function addGapBox(gap: ScheduleGap, title: string) {
    if (hasActiveSessionLock) {
      setFormError('Önce bunu bitir.');
      return;
    }
    const newBox: Box = {
      id: Date.now().toString(),
      title,
      duration: gap.duration,
      time: gap.start,
    };
    setBoxes((previousBoxes) => [...previousBoxes, newBox]);
  }

  function restartMorningRitual() {
    localStorage.removeItem(getMorningRitualStorageKey());
    localStorage.removeItem(getLegacyMorningRitualStorageKey());
    router.push('/sabah-toreni');
  }

  function exportData() {
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('tibo-')) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      try {
        payload[key] = JSON.parse(value);
      } catch {
        payload[key] = value;
      }
    }

    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      app: 'TiBo',
      data: payload,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tibo-veri-${getTodayStamp()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
      const data = parsed.data;
      if (!data || typeof data !== 'object') return;

      const shouldImport = window.confirm('Veri içe aktarılsın mı? Aynı kayıtlar değişir.');
      if (!shouldImport) return;

      let importedCount = 0;
      for (const [key, value] of Object.entries(data)) {
        if (!isAllowedBackupKey(key)) continue;
        if (typeof value === 'string' && value.length > 2_000_000) continue;
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (serialized.length > 2_000_000) continue;
        localStorage.setItem(key, serialized);
        importedCount += 1;
      }
      if (importedCount === 0) {
        window.alert('İçe aktarılacak geçerli TiBo verisi bulunamadı.');
        return;
      }
      window.location.reload();
    } catch {
      window.alert('JSON dosyası okunamadı.');
    } finally {
      event.target.value = '';
    }
  }

  if (!isLoaded) return null;

  const sortedBoxes = [...boxes].sort((a, b) => a.time.localeCompare(b.time));
  const scheduleGaps = findScheduleGaps(sortedBoxes);

  const totalMinutes = boxes.reduce((total, box) => total + box.duration, 0);
  const hourCount = Math.floor(totalMinutes / 60);
  const minuteCount = totalMinutes % 60;
  const formattedDuration =
    hourCount > 0 && minuteCount > 0
      ? `${hourCount}s ${minuteCount}dk`
      : hourCount > 0
      ? `${hourCount}s`
      : minuteCount > 0
      ? `${minuteCount}dk`
      : '';
  const parsedTaskPreview = parseTaskCommand(taskTitle);
  const previewTaskTitle = parsedTaskPreview.title;
  const previewDuration = parsedTaskPreview.durationFromCommand ?? Number(duration || 30);
  const matchingCompletedBoxes = completedHistory.filter(
    (completedBox) =>
      isValidCompletedBox(completedBox) &&
      normalizeTaskTitle(completedBox.boxTitle) === normalizeTaskTitle(previewTaskTitle),
  );
  const averageActualMinutes = matchingCompletedBoxes.length > 0
    ? Math.round(
        matchingCompletedBoxes.reduce(
          (total, completedBox) =>
            total + ((completedBox.actualDurationSeconds ?? completedBox.actualDuration * 60) / 60),
          0,
        ) / matchingCompletedBoxes.length,
      )
    : 0;
  const latestCompletedBox = [...matchingCompletedBoxes].sort((a, b) =>
    b.finishedAt.localeCompare(a.finishedAt),
  )[0] ?? null;
  const enteredDuration = previewDuration;
  const estimateDeltaPercent =
    enteredDuration > 0 && averageActualMinutes > 0
      ? Math.round(((averageActualMinutes - enteredDuration) / enteredDuration) * 100)
      : 0;
  const shouldShowEstimateWarning = previewTaskTitle.length > 0 && matchingCompletedBoxes.length > 0;
  const suggestedCompressedDuration = averageActualMinutes > 0
    ? roundUpToFive(averageActualMinutes)
    : 0;
  const compressionDeltaPercent =
    enteredDuration > 0 && suggestedCompressedDuration > 0
      ? Math.round(((enteredDuration - suggestedCompressedDuration) / enteredDuration) * 100)
      : 0;
  const compressedDuration =
    matchingCompletedBoxes.length >= 3 &&
    enteredDuration > 0 &&
    suggestedCompressedDuration < enteredDuration &&
    compressionDeltaPercent >= 10
      ? suggestedCompressedDuration
      : null;
  const hasStrongEstimateWarning =
    compressedDuration !== null || (matchingCompletedBoxes.length >= 3 && Math.abs(estimateDeltaPercent) >= 15);
  const riskLabel = hasStrongEstimateWarning ? 'yüksek' : shouldShowEstimateWarning ? 'ölçüldü' : '—';
  const currentBoxIds = new Set(boxes.map((box) => box.id));
  const todaysCompletedBoxes = completedHistory.filter(
    (completedBox) =>
      isValidCompletedBox(completedBox) &&
      completedBox.date === getTodayStamp() &&
      currentBoxIds.has(completedBox.boxId),
  );
  const completedCount = todaysCompletedBoxes.length;
  const plannedMinutesFromCompleted = todaysCompletedBoxes.reduce(
    (total, completedBox) => total + completedBox.plannedDuration,
    0,
  );
  const actualMinutes = Math.round(
    todaysCompletedBoxes.reduce(
      (total, completedBox) => total + ((completedBox.actualDurationSeconds ?? completedBox.actualDuration * 60) / 60),
      0,
    ),
  );
  const varianceMinutes = actualMinutes > 0 ? actualMinutes - totalMinutes : 0;
  const varianceDisplay = actualMinutes > 0
    ? `${varianceMinutes > 0 ? '+' : varianceMinutes < 0 ? '-' : ''}${formatMinutes(Math.abs(varianceMinutes))}`
    : '—';
  const hasCriticalVariance = isCriticalVariance(totalMinutes, actualMinutes);
  const estimateAccuracy = completedCount > 0 && plannedMinutesFromCompleted > 0 && actualMinutes > 0
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round((1 - Math.abs(actualMinutes - plannedMinutesFromCompleted) / plannedMinutesFromCompleted) * 100),
        ),
      )
    : null;
  const earliestStart = sortedBoxes.length > 0
    ? Math.min(...sortedBoxes.map((box) => parseTimeToMinutes(box.time)))
    : 8 * 60;
  const latestEnd = sortedBoxes.length > 0
    ? Math.max(...sortedBoxes.map((box) => parseTimeToMinutes(box.time) + box.duration))
    : 18 * 60;
  const gridStart = Math.max(0, earliestStart - 30);
  const gridEnd = Math.min(24 * 60, latestEnd + 30);
  const gridHeight = Math.max(180, gridEnd - gridStart);
  const firstHour = Math.ceil(gridStart / 60) * 60;
  const hourTicks = Array.from(
    { length: Math.max(0, Math.floor((gridEnd - firstHour) / 60) + 1) },
    (_, index) => firstHour + index * 60,
  );
  const blockedItems =
    morningRitual && !morningRitual.skipped
      ? morningRitual.blockedItems.filter((item) => item.trim().length > 0)
      : [];
  const taskValidationError = validateTaskInput(taskTitle, duration);
  const isStartEnabled = taskValidationError === null;

  return (
    <main className="animate-fade-in min-h-screen tibo-page px-6 py-6 md:px-8 lg:py-8">
      <div className="mx-auto grid w-full max-w-[1180px] gap-8 lg:grid-cols-[220px_minmax(0,680px)_168px] xl:gap-10">
        <aside className="lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">
          <div className="flex h-full flex-col">
            <div>
              <h1 className="tibo-hero-mark font-tibo-mono text-[32px] font-bold tracking-tighter">
                TiBo
              </h1>
              <p className="tibo-data tibo-meta mt-4">{getTodayLabel()}</p>
            </div>

            <div className="my-8 border-t border-[var(--color-border-soft)]" />

            {morningRitual ? (
              <div>
                <Label className="mb-4">Bugünün İşi</Label>
                <p className="mb-6 break-words text-[18px] font-medium leading-snug tracking-[-0.01em] text-zinc-200/85">
                  {morningRitual.primaryGoal}
                </p>
                <div className="flex flex-col gap-2 tibo-meta">
                  <span><span className="tibo-data">{morningRitual.deepWorkStart} - {morningRitual.deepWorkEnd}</span></span>
                  <span><span className="tibo-data">{morningRitual.blockedItems.length}</span> engel</span>
                </div>
              </div>
            ) : sortedBoxes.length > 0 ? (
              <div>
                <Label className="mb-4">Bugünün İşi</Label>
                <p className="mb-6 break-words text-[18px] font-medium leading-snug tracking-[-0.01em] text-zinc-200/85 capitalize">
                  {sortedBoxes[0].title}
                </p>
                <div className="flex flex-col gap-2 tibo-meta">
                  <span><span className="tibo-data">{sortedBoxes[0].time}</span> başlangıç</span>
                  <span><span className="tibo-data">{sortedBoxes.length}</span> kutu</span>
                </div>
              </div>
            ) : (
              <div>
                <Label className="mb-4">Bugünün İşi</Label>
                <Link href="/sabah-toreni" className="text-zinc-400 hover:text-white text-[15px] transition-colors duration-150">
                  Plan yok. Kur →
                </Link>
              </div>
            )}

            <div className="mt-8 border-t border-[var(--color-border-soft)] pt-6">
              <Link href="/gecmis" className="block text-zinc-600 hover:text-zinc-300 text-[15px] transition-colors duration-150 mb-4">
                Geçmiş →
              </Link>
              <SidebarItem
                onClick={restartMorningRitual}
                className="mb-4 text-zinc-600 hover:text-zinc-300"
              >
                Planı Yenile →
              </SidebarItem>
              <SidebarItem
                onClick={() => setIsBackupOpen((current) => !current)}
              >
                Yedek
              </SidebarItem>
              {FEEDBACK_URL && (
                <a
                  href={FEEDBACK_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 block text-xs text-zinc-700 hover:text-zinc-400 transition-colors duration-150"
                >
                  Geri Bildirim ↗
                </a>
              )}
              {isBackupOpen && (
                <div className="mt-4 flex flex-col items-start gap-2 text-xs text-zinc-600">
                  <SidebarItem onClick={exportData} className="text-xs">· indir</SidebarItem>
                  <SidebarItem onClick={() => importInputRef.current?.click()} className="text-xs">· yükle</SidebarItem>
                </div>
              )}
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                onChange={importData}
                className="hidden"
              />
            </div>
          </div>
        </aside>

        <section className="lg:pt-0">
          <header className="mb-5">
            <h2 className="tibo-h1 text-zinc-50">
              Bugün
            </h2>
            <p className="tibo-body mt-2 text-zinc-500">
              Görev. Süre. Başlat.
            </p>
          </header>

          <Card className="tibo-start-card mb-6 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_88px_210px]">
              <Input
                type="text"
                placeholder="Bugün gerçekten neye odaklanıyorsun?"
                value={taskTitle}
                onChange={(e) => {
                  setTaskTitle(e.target.value);
                  if (formError) setFormError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && startFocus()}
                autoFocus
                aria-label="Tek görev"
                className={taskShake ? 'tibo-shake' : undefined}
              />
              <Input
                type="number"
                placeholder="30 dk"
                min={1}
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value);
                  if (formError) setFormError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && startFocus()}
                className="font-tibo-mono text-center"
                aria-label="Süre dakika"
                title="Süre dakika"
              />
              <Button onClick={startFocus} size="md" variant="secondary" disabled={!isStartEnabled}>
                <Play className="h-4 w-4" strokeWidth={1.75} />
                Çalışmaya Başla
              </Button>
            </div>
            {formError && (
              <p className="tibo-meta mt-4 text-red-400">{formError}</p>
            )}
            {continuationWarning && !formError && (
              <p className="tibo-meta mt-4 text-zinc-400">{continuationWarning}</p>
            )}
          </Card>

          {(scheduleGaps.length > 0 || shouldShowEstimateWarning) && (
            <details className="group mb-4 border border-[var(--color-border-soft)] bg-[var(--color-surface)]/35">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
                <Label>Uyarılar</Label>
                <span className="tibo-meta text-zinc-700 group-open:hidden">aç</span>
                <span className="hidden tibo-meta text-zinc-700 group-open:inline">kapat</span>
              </summary>
              <div className="border-t border-[var(--color-border-soft)] px-4 py-4">
                {scheduleGaps.length > 0 && (
                  <div className="mb-4 border-l border-zinc-700/70 pl-4">
                    <Label className="mb-2 text-zinc-500">Tanımsız Zaman</Label>
                    <div className="flex flex-col gap-3">
                      {scheduleGaps.map((gap) => (
                        <div key={`${gap.start}-${gap.end}`} className="flex items-center justify-between gap-4">
                          <p className="tibo-body text-zinc-400">{gap.start}-{gap.end}: {formatMinutes(gap.duration)} boş.</p>
                          <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={() => addGapBox(gap, 'Dinlenme')}>Dinlenme</Button>
                            <Button variant="secondary" size="sm" onClick={() => addGapBox(gap, 'Bilinçli boşluk')}>Bilinçli boşluk</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {shouldShowEstimateWarning && (
                  <div className={`border-l pl-4 ${hasStrongEstimateWarning ? 'border-red-500/70' : 'border-zinc-700/70'}`}>
                    <Label className="mb-2 text-zinc-500">Tahmin Hesaplayıcı</Label>
                    {matchingCompletedBoxes.length === 1 && latestCompletedBox ? (
                      <p className="tibo-body text-zinc-400">
                        Son gerçek süre: {formatMinutes(
                          Math.round((latestCompletedBox.actualDurationSeconds ?? latestCompletedBox.actualDuration * 60) / 60),
                        )}.
                      </p>
                    ) : (
                      <p className="tibo-body text-zinc-400">
                        {matchingCompletedBoxes.length} kayıt. Ortalama: {formatMinutes(averageActualMinutes)}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </details>
          )}

          {sortedBoxes.length === 0 ? (
            <Link
              href="/sabah-toreni"
              className="mb-6 inline-flex text-sm text-zinc-500 transition-colors duration-150 hover:text-zinc-300"
            >
              Plan yok. Kur →
            </Link>
          ) : (
            <div className="relative tibo-time-grid-shell mb-6 px-4 py-4 opacity-55">
              <div className="mb-4 flex items-center justify-between">
                <Label>Günün Şekli</Label>
                <p className="tibo-data tibo-meta text-zinc-700">{formatClock(gridStart)} - {formatClock(gridEnd)}</p>
              </div>
              <div className="relative ml-16" style={{ height: `${gridHeight}px` }}>
                <div className="absolute left-0 top-0 bottom-0 w-px bg-[var(--color-border-soft)]" />
                {hourTicks.map((tick) => (
                  <div key={tick} className="absolute left-0 right-0 border-t border-zinc-900/40" style={{ top: `${tick - gridStart}px` }}>
                    <span className="absolute -left-16 -top-2 tibo-data tibo-meta text-zinc-600">{formatClock(tick)}</span>
                  </div>
                ))}
                {sortedBoxes.map((box) => {
                  const startsAt = parseTimeToMinutes(box.time);
                  return (
                    <div
                      key={box.id}
                      className="tibo-time-block absolute left-6 right-0 px-4 py-2"
                      style={{
                        top: `${startsAt - gridStart}px`,
                        minHeight: '56px',
                        height: `${Math.max(56, box.duration)}px`,
                      }}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--color-primary)]" />
                      <div className="flex h-full min-h-[32px] items-center gap-4 pl-2">
                        <p className="tibo-data tibo-meta text-zinc-400 whitespace-nowrap">
                          {box.time} · {box.duration}dk
                        </p>
                        <p className="text-white text-base font-medium truncate flex-1 capitalize">{box.title}</p>
                        <Button
                          onClick={() => deleteBox(box.id)}
                          variant="ghost"
                          size="sm"
                          className="h-auto px-2 py-2 text-zinc-700 hover:text-red-500"
                          aria-label="Kutuyu sil"
                        >
                          <X className="h-4 w-4" strokeWidth={1.75} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {boxes.length > 0 && (
            <details className="group mt-8 border border-[var(--color-border-soft)] bg-[var(--color-surface)]/60">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4">
                <Label>Gün Özeti</Label>
                <span className="tibo-data tibo-meta text-zinc-700 group-open:hidden">
                  {boxes.length} kutu · {formattedDuration || '—'}
                </span>
                <span className="hidden tibo-data tibo-meta text-zinc-700 group-open:inline">
                  kapat
                </span>
              </summary>
              <div className="border-t border-zinc-900">
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  <MetricCard
                    label="Planlanan Süre"
                    value={formattedDuration || '—'}
                    hint={`${boxes.length} kutu`}
                  />
                  <MetricCard
                    label="Sapma"
                    value={varianceDisplay}
                    hint={actualMinutes > 0 ? 'planlanan / gerçek' : riskLabel === '—' ? 'ölçüm yok' : `risk: ${riskLabel}`}
                    tone={hasCriticalVariance ? 'danger' : 'default'}
                    className="sm:border-l-0"
                  />
                </div>
                <div className="border-t border-zinc-900 px-4 py-3">
                  <p className="tibo-meta text-zinc-600">Tamamlanan: {completedCount}/{boxes.length}</p>
                </div>
              </div>
            </details>
          )}
        </section>

        <aside className="border-t border-[var(--color-border-soft)] pt-6 lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] lg:border-t-0 lg:pt-1">
          <div className="flex h-full flex-col text-zinc-700">
            <section aria-label="Bugünkü odak engelleri">
              <Label className="mb-3 text-zinc-700">Odak Engeli</Label>
              {blockedItems.length > 0 ? (
                <div className="flex flex-wrap gap-x-3 gap-y-2 lg:flex-col lg:gap-2">
                  {blockedItems.slice(0, 4).map((item) => (
                    <span key={item} className="tibo-meta truncate text-zinc-600">
                      {item}
                    </span>
                  ))}
                  {blockedItems.length > 4 && (
                    <span className="tibo-meta text-zinc-700">+{blockedItems.length - 4}</span>
                  )}
                </div>
              ) : (
                <p className="tibo-data tibo-meta text-zinc-700">—</p>
              )}
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
