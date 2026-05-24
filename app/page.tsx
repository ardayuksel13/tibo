'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Clock, History, Lock, RefreshCw } from 'lucide-react';
import { trackEvent } from './lib/analytics';
import { useLanguage, tf } from './lib/i18n';

type Box = {
  id: string;
  title: string;
  duration: number;
  time: string;
};

type MorningRitual = {
  primaryGoal: string;
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
  completionType?: CompletionType;
};

type Note = {
  boxId: string;
  boxTitle: string;
  note: string;
  finishedAt: string;
};

type CompletionType = 'completed' | 'early_exit';

const ACTIVE_SESSION_KEY = 'tibo-active-session';
const LATEST_NEXT_STEP_KEY = 'tibo-next-step-latest';
const NEXT_STEP_HISTORY_KEY = 'tibo-next-step-history';

function getTodayLabel(language: 'tr' | 'en'): string {
  return new Intl.DateTimeFormat(language === 'tr' ? 'tr-TR' : 'en-US', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).format(new Date());
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
  if (hours > 0 && remainingMinutes > 0) return `${hours}h ${remainingMinutes}m`;
  if (hours > 0) return `${hours}h`;
  if (remainingMinutes > 0) return `${remainingMinutes}m`;
  return '0m';
}

function shouldUseSecondPrecision(plannedSeconds: number, actualSeconds = plannedSeconds): boolean {
  return plannedSeconds < 5 * 60 || actualSeconds < 5 * 60;
}

function formatDurationSeconds(seconds: number, useSecondPrecision: boolean): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  if (!useSecondPrecision) {
    return formatMinutes(Math.round(safeSeconds / 60));
  }

  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (minutes > 0 && remainingSeconds > 0) return `${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${remainingSeconds}s`;
}

function formatSignedDurationSeconds(seconds: number, useSecondPrecision: boolean): string {
  const roundedSeconds = Math.round(seconds);
  if (roundedSeconds === 0) return useSecondPrecision ? '0s' : '0m';
  const sign = roundedSeconds > 0 ? '+' : '-';
  return `${sign}${formatDurationSeconds(Math.abs(roundedSeconds), useSecondPrecision)}`;
}

function isCriticalVariance(plannedMinutes: number, actualMinutes: number): boolean {
  if (plannedMinutes <= 0 || actualMinutes <= 0) return false;
  const delta = Math.abs(actualMinutes - plannedMinutes);
  return delta >= 10 || delta / plannedMinutes > 0.2;
}

function roundUpToFive(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

function isReliableCompletion(plannedSeconds: number, actualSeconds: number): boolean {
  if (plannedSeconds <= 0 || actualSeconds <= 0) return false;
  const remainingSeconds = plannedSeconds - actualSeconds;
  const remainingRatio = remainingSeconds / plannedSeconds;
  return actualSeconds / plannedSeconds >= 0.5 || remainingSeconds <= 15 || remainingRatio <= 0.1;
}

function resolveCompletionType(
  plannedSeconds: number,
  actualSeconds: number,
  completionType?: CompletionType,
): CompletionType {
  if (completionType) return completionType;
  return isReliableCompletion(plannedSeconds, actualSeconds) ? 'completed' : 'early_exit';
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
  const { language } = useLanguage('en');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [duration, setDuration] = useState('30');
  const [time] = useState('');
  const [formError, setFormError] = useState('');
  const [taskShake, setTaskShake] = useState(false);
  const [morningRitual, setMorningRitual] = useState<MorningRitual | null>(null);
  const [completedHistory, setCompletedHistory] = useState<CompletedBox[]>([]);
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

    if (!ritualRecord) {
      router.replace('/sabah-toreni');
      return;
    }

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
        setContinuationWarning(tf(language, 'İlerleme yok.', 'No progress.'));
      } else {
        setContinuationWarning('');
      }
    } else if (resumeNotes.length >= 2) {
      const latest = normalizeTaskTitle(resumeNotes[0]);
      const previous = normalizeTaskTitle(resumeNotes[1]);
      if (latest.length >= 3 && latest === previous) {
        setContinuationWarning(tf(language, 'İlerleme yok.', 'No progress.'));
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
  }, [router, language]);

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
    const typedDuration = rawDuration.trim().length > 0 ? Number(rawDuration) : NaN;
    const selectedDuration = parsedTask.durationFromCommand ?? Number(rawDuration);

    if (!title) return tf(language, 'Önce görevi tanımla.', 'Define the task first.');
    if (title.length < 3) return tf(language, 'Önce görevi tanımla.', 'Define the task first.');
    if (isVagueTaskTitle(title)) return tf(language, 'Önce görevi tanımla.', 'Define the task first.');
    if (parsedTask.durationFromCommand === null && !Number.isFinite(typedDuration)) return tf(language, 'Önce süreyi seç.', 'Set duration first.');
    if (!Number.isFinite(selectedDuration) || selectedDuration <= 0) return tf(language, 'Önce süreyi seç.', 'Set duration first.');
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

  function startFocus() {
    if (hasActiveSessionLock) {
      setFormError(tf(language, 'Önce bunu bitir.', 'Finish current block first.'));
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
      setFormError(tf(language, 'Önce görevi tanımla.', 'Define the task first.'));
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

  function restartMorningRitual() {
    localStorage.removeItem(getMorningRitualStorageKey());
    localStorage.removeItem(getLegacyMorningRitualStorageKey());
    router.push('/sabah-toreni');
  }

  if (!isLoaded) return null;

  const sortedBoxes = [...boxes].sort((a, b) => a.time.localeCompare(b.time));
  const plannedCount = boxes.length;
  const parsedTaskPreview = parseTaskCommand(taskTitle);
  const previewTaskTitle = parsedTaskPreview.title;
  const previewDuration = parsedTaskPreview.durationFromCommand ?? Number(duration || 30);
  const matchingCompletedBoxes = completedHistory.filter((completedBox) => {
    if (!isValidCompletedBox(completedBox)) return false;
    if (normalizeTaskTitle(completedBox.boxTitle) !== normalizeTaskTitle(previewTaskTitle)) return false;
    const plannedSeconds = completedBox.plannedDuration * 60;
    const actualSecondsForBox = completedBox.actualDurationSeconds ?? completedBox.actualDuration * 60;
    const completionType = resolveCompletionType(plannedSeconds, actualSecondsForBox, completedBox.completionType);
    return completionType === 'completed';
  });
  const averageActualMinutes = matchingCompletedBoxes.length > 0
    ? Math.round(
        matchingCompletedBoxes.reduce(
          (total, completedBox) =>
            total + ((completedBox.actualDurationSeconds ?? completedBox.actualDuration * 60) / 60),
          0,
        ) / matchingCompletedBoxes.length,
      )
    : 0;
  const enteredDuration = previewDuration;
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
  const plannedSecondsFromCompleted = plannedMinutesFromCompleted * 60;
  const actualSeconds = todaysCompletedBoxes.reduce(
    (total, completedBox) => total + (completedBox.actualDurationSeconds ?? completedBox.actualDuration * 60),
    0,
  );
  const actualMinutes = completedCount > 0 ? actualSeconds / 60 : 0;
  const varianceSeconds = completedCount > 0 ? actualSeconds - plannedSecondsFromCompleted : 0;
  const useSecondPrecision = completedCount > 0
    ? shouldUseSecondPrecision(plannedSecondsFromCompleted, actualSeconds)
    : false;
  const varianceDisplay = completedCount > 0
    ? formatSignedDurationSeconds(varianceSeconds, useSecondPrecision)
    : '—';
  const hasCriticalVariance =
    completedCount > 0 && isCriticalVariance(plannedMinutesFromCompleted, actualMinutes);
  const estimateAccuracy = completedCount > 0 && plannedSecondsFromCompleted > 0 && actualSeconds > 0
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round((1 - Math.abs(actualSeconds - plannedSecondsFromCompleted) / plannedSecondsFromCompleted) * 100),
        ),
      )
    : null;
  const blockedItems =
    morningRitual && !morningRitual.skipped
      ? morningRitual.blockedItems.filter((item) => item.trim().length > 0)
      : [];
  const taskValidationError = validateTaskInput(taskTitle, duration);
  const isStartEnabled = taskValidationError === null;
  const ritualIsActive = Boolean(morningRitual && !morningRitual.skipped);
  const mainGoal = ritualIsActive ? morningRitual?.primaryGoal ?? '' : sortedBoxes[0]?.title ?? '';
  const obstacleText = blockedItems.join(', ');
  const focusScore = estimateAccuracy === null ? '—' : `%${estimateAccuracy}`;
  const scoreLabel = tf(language, `İsabet ${focusScore}`, `Accuracy ${focusScore}`);
  const activeFocusBars = estimateAccuracy === null ? 0 : Math.round((estimateAccuracy / 100) * 8);
  const rightCompletedLabel = plannedCount > 0 ? `${completedCount}/${plannedCount}` : '—';
  const rightTotalFocus = completedCount > 0
    ? formatDurationSeconds(actualSeconds, useSecondPrecision)
    : '—';
  const remainingCount = Math.max(0, plannedCount - completedCount);
  const hasPendingBoxes = remainingCount > 0;
  const ctaLabel = hasPendingBoxes
    ? tf(language, 'Sıradaki Göreve Devam Et', 'Continue Next Task')
    : tf(language, 'Yeni Odak Bloğunu Başlat', 'Start New Focus Block');
  const taskSectionLabel = hasPendingBoxes
    ? tf(language, 'YENİ GÖREV (İSTEĞE BAĞLI)', 'NEW TASK (OPTIONAL)')
    : tf(language, 'SIRADAKİ GÖREV', 'NEXT TASK');
  const taskSectionHint = hasPendingBoxes
    ? tf(
      language,
      `${remainingCount} görev hazır. İstersen yeni görev ekle, istemezsen doğrudan devam et.`,
      `${remainingCount} task(s) ready. Add a new one or continue directly.`,
    )
    : tf(language, 'Şimdi yapacağın tek işi yaz ve süre ver.', 'Write one task and set its duration.');
  const t = {
    protocolName: tf(language, 'TiBo', 'TiBo'),
    navTask: tf(language, 'GÖREV', 'TASK'),
    navClosure: tf(language, 'KAPANIŞ', 'CLOSURE'),
    navHistory: tf(language, 'GEÇMİŞ', 'HISTORY'),
    localStorage: tf(language, 'Veriler bu cihazda saklanır.', 'Data stays on this device.'),
    flow: tf(language, 'GÖREV AKIŞI', 'TASK FLOW'),
    refresh: tf(language, 'AKIŞI YENİLE', 'RESET FLOW'),
    hero: tf(language, 'Sıradaki görevi başlat', 'Start the next task'),
    heroSub: tf(language, 'TEK İŞ. KISITLI SÜRE. NET SONUÇ.', 'ONE TASK. LIMITED TIME. CLEAR RESULT.'),
    taskPlaceholder: tf(language, 'Sıradaki görevi yaz.', 'Write the next task.'),
    taskAria: tf(language, 'Sıradaki görev', 'Next task'),
    focusBlock: tf(language, 'ODAK BLOĞU', 'FOCUS BLOCK'),
    duration: tf(language, 'SÜRE', 'DURATION'),
    durationAria: tf(language, 'Süre dakika', 'Duration minutes'),
    durationHint: tf(language, 'Süre tahmini: yalnızca bu görev için.', 'Duration estimate for this task only.'),
    traps: tf(language, 'DİKKAT TUZAKLARI', 'FOCUS TRAPS'),
    trapsPlaceholder: tf(language, 'Dikkatini dağıtabilecek şeyleri yaz.', 'Write potential distractions.'),
    taskRule: tf(language, 'GÖREV KURALI', 'TASK RULE'),
    taskRulePlaceholder: tf(language, 'Bu blokta neye odaklanıyorsun?', 'What is your focus in this block?'),
    status: tf(language, 'GÖREV DURUMU', 'TASK STATUS'),
    completedBox: tf(language, 'Tamamlanan Kutu', 'Completed Boxes'),
    variance: tf(language, 'Sapma', 'Variance'),
    totalFocus: tf(language, 'Toplam Odak', 'Total Focus'),
    estimateVariance: tf(language, 'Tahmin sapması', 'Estimate variance'),
    estimateHint: tf(language, 'Tahmin ile gerçek süre farkı.', 'Difference between estimate and actual time.'),
    protocolData: tf(language, 'GÖREV DURUMU', 'TASK STATUS'),
  };

  return (
    <main className="tibo-ref-page animate-fade-in">
      <div className="tibo-ref-shell">
        <aside className="tibo-ref-sidebar">
          <div>
            <div className="mb-12">
              <Link href="/" className="tibo-ref-logo" aria-label="TiBo ana sayfa">
                {t.protocolName}
                <span>.</span>
              </Link>
            </div>

            <nav className="tibo-ref-nav" aria-label="TiBo bölümleri">
              <a href="#plan" className="tibo-ref-nav-item is-active">
                <span>{t.navTask}</span>
                <i />
              </a>
              <Link href="/focus?gunSonu=1" className="tibo-ref-nav-item">
                <Lock className="h-4 w-4 tibo-ref-nav-icon" strokeWidth={1.8} />
                {t.navClosure}
              </Link>
              <Link href="/gecmis" className="tibo-ref-nav-item">
                <History className="h-4 w-4 tibo-ref-nav-icon" strokeWidth={1.8} />
                {t.navHistory}
              </Link>
            </nav>
          </div>

          <div className="tibo-ref-sidebar-lower">
            <div className="tibo-ref-storage">
              <span>{t.localStorage}</span>
              <div className="tibo-ref-node">N</div>
            </div>
          </div>
        </aside>

        <section className="tibo-ref-main">
          <header className="tibo-ref-topbar">
            <p>{t.flow}</p>
            <div>
              <span>{getTodayLabel(language).toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US')}</span>
              <button type="button" onClick={restartMorningRitual}>
                {t.refresh}
                <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          </header>

          <div id="plan" className="tibo-ref-content-grid">
            <div className="tibo-ref-primary">
              <section className="tibo-ref-hero-block">
                <h1 className="tibo-ref-hero">
                  {t.hero}<span>.</span>
                </h1>
                <p>{t.heroSub}</p>
              </section>

              <section className="tibo-ref-task-section">
                <label htmlFor="task-title-ref">{taskSectionLabel}</label>
                <div className={`tibo-ref-main-input ${taskShake ? 'tibo-shake' : ''}`}>
                  <input
                    id="task-title-ref"
                    value={taskTitle}
                    onChange={(event) => {
                      setTaskTitle(event.target.value.slice(0, 80));
                      setFormError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') startFocus();
                    }}
                    placeholder={t.taskPlaceholder}
                    autoFocus
                    spellCheck={false}
                    aria-label={t.taskAria}
                  />
                  <span>{taskTitle.length} / 80</span>
                </div>
                {formError && <p className="tibo-ref-error">{formError}</p>}
                {continuationWarning && !formError && <p className="tibo-ref-muted-line">{continuationWarning}</p>}
                {!formError && <p className="tibo-ref-muted-line">{taskSectionHint}</p>}
              </section>

              <section className="tibo-ref-form-grid">
                <div className="tibo-ref-focus-block">
                  <h2>{t.focusBlock}</h2>
                  <label htmlFor="duration-ref">{t.duration}</label>
                  <div className="tibo-ref-time-input">
                    <input
                      id="duration-ref"
                      type="number"
                      min="1"
                      spellCheck={false}
                      value={duration}
                      onChange={(event) => {
                        setDuration(event.target.value);
                        setFormError('');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') startFocus();
                      }}
                      aria-label={t.durationAria}
                    />
                    <Clock className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                  <p>{t.durationHint}</p>
                </div>

                <div className="tibo-ref-mini-panel">
                  <h2>{t.traps}</h2>
                  <textarea readOnly value={obstacleText} placeholder={t.trapsPlaceholder} spellCheck={false} />
                  <span>{obstacleText.length} / 120</span>
                </div>

                <div className="tibo-ref-mini-panel">
                  <h2>{t.taskRule}</h2>
                  <textarea readOnly value={mainGoal} placeholder={t.taskRulePlaceholder} spellCheck={false} />
                  <span>{mainGoal.length} / 120</span>
                </div>
              </section>

              <button
                type="button"
                className={`tibo-ref-blue-cta ${!isStartEnabled && !hasPendingBoxes ? 'is-locked' : ''}`}
                onClick={startFocus}
                aria-disabled={!isStartEnabled && !hasPendingBoxes}
              >
                <span>ENTER ↵</span>
                <strong>{ctaLabel}</strong>
                <ArrowRight className="h-6 w-6" strokeWidth={1.6} />
              </button>
            </div>

            <aside className="tibo-ref-right-rail">
              <section>
                <h2>{t.protocolData}</h2>
                <dl>
                  <div>
                    <dt>{t.completedBox}</dt>
                    <dd>{rightCompletedLabel}</dd>
                  </div>
                  <div>
                    <dt>{t.variance}</dt>
                    <dd className={hasCriticalVariance ? 'is-danger' : 'is-blue'}>{varianceDisplay}</dd>
                  </div>
                  <div>
                    <dt>{t.totalFocus}</dt>
                    <dd>{rightTotalFocus}</dd>
                  </div>
                </dl>
              </section>

              <section className="tibo-ref-focus-score">
                <div className="tibo-ref-focus-score-line">
                  <span>{t.estimateVariance}</span>
                  <strong>{scoreLabel}</strong>
                  <i />
                </div>
                <p className="tibo-ref-focus-note">{t.estimateHint}</p>
                <div className="tibo-ref-bars" aria-hidden="true">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <span key={index} className={index < activeFocusBars ? 'is-active' : ''} />
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
