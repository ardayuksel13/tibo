'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { toPng } from 'html-to-image';
import { Check, Download, Pause, Play, X } from 'lucide-react';
import { Button, Card, Input, Label, MetricCard, TimerDisplay } from '../components/ui';
import { trackEvent } from '../lib/analytics';

type Box = {
  id: string;
  title: string;
  duration: number;
  time: string;
};

type Note = {
  boxId: string;
  boxTitle: string;
  note: string;
  finishedAt: string;
};

type CompletedBox = {
  boxId: string;
  boxTitle: string;
  plannedDuration: number;
  actualDuration: number;
  actualDurationSeconds: number;
  pauseDuration: number;
  startedAt: string;
  finishedAt: string;
  date: string;
};

type ResolvedCompletedBox = CompletedBox & {
  resolvedPlannedMinutes: number;
  resolvedActualSeconds: number;
};

type MorningRitual = {
  blockedItems: string[];
  skipped?: boolean;
};

type BreakReason = 'Odak kaybettim' | 'Yanlış görev' | 'Acil durum' | 'Diğer';
const ACTIVE_SESSION_KEY = 'tibo-active-session';
const LATEST_NEXT_STEP_KEY = 'tibo-next-step-latest';
const NEXT_STEP_HISTORY_KEY = 'tibo-next-step-history';

const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

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

function getBoxesStorageKey(): string {
  return `tibo-boxes-${getTodayStamp()}`;
}

function getLegacyBoxesStorageKey(): string {
  return `tibo-boxes-${getLegacyTodayStamp()}`;
}

function getNotesStorageKey(): string {
  return `tibo-notes-${getTodayStamp()}`;
}

function getLegacyNotesStorageKey(): string {
  return `tibo-notes-${getLegacyTodayStamp()}`;
}

function getCompletedStorageKey(): string {
  return `tibo-completed-${getTodayStamp()}`;
}

function getLegacyCompletedStorageKey(): string {
  return `tibo-completed-${getLegacyTodayStamp()}`;
}

function getMorningRitualStorageKey(): string {
  return `tibo-toren-${getTodayStamp()}`;
}

function getLegacyMorningRitualStorageKey(): string {
  return `tibo-toren-${getLegacyTodayStamp()}`;
}

function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) return `${hours}s ${remainingMinutes}dk`;
  if (hours > 0) return `${hours}s`;
  if (remainingMinutes > 0) return `${remainingMinutes}dk`;
  return '0dk';
}

function formatSignedMinutes(minutes: number): string {
  if (minutes === 0) return '0dk';
  const sign = minutes > 0 ? '+' : '-';
  return `${sign}${formatMinutes(Math.abs(minutes))}`;
}

function isCriticalVariance(plannedMinutes: number, actualMinutes: number): boolean {
  if (plannedMinutes <= 0 || actualMinutes <= 0) return false;
  const delta = Math.abs(actualMinutes - plannedMinutes);
  return delta >= 10 || delta / plannedMinutes > 0.2;
}

function resolveActualSeconds(completedBox: CompletedBox): number {
  const fromSeconds = completedBox.actualDurationSeconds;
  if (Number.isFinite(fromSeconds) && (fromSeconds ?? 0) > 0) {
    return fromSeconds as number;
  }

  const fromMinutes = completedBox.actualDuration;
  if (Number.isFinite(fromMinutes) && fromMinutes > 0) {
    return Math.round(fromMinutes * 60);
  }

  const startedAtMs = Date.parse(completedBox.startedAt);
  const finishedAtMs = Date.parse(completedBox.finishedAt);
  if (Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs) && finishedAtMs > startedAtMs) {
    return Math.max(1, Math.round((finishedAtMs - startedAtMs) / 1000));
  }

  return 0;
}

function getTodayLabel(): string {
  const today = new Date();
  return `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()} ${DAYS[today.getDay()]}`;
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hour}:${minute}`;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readAllNotes(): Note[] {
  try {
    const notes: Note[] = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('tibo-notes-')) continue;
      try {
        const value = localStorage.getItem(key);
        if (value) {
          const parsed: Note[] = JSON.parse(value);
          notes.push(...parsed);
        }
      } catch {
        // Skip malformed note records.
      }
    }
    return notes;
  } catch {
    return [];
  }
}

function readTodaysCompletedBoxes(): CompletedBox[] {
  try {
    const data =
      localStorage.getItem(getCompletedStorageKey()) ??
      localStorage.getItem(getLegacyCompletedStorageKey());
    return data ? (JSON.parse(data) as CompletedBox[]) : [];
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

function readMorningRitual(): MorningRitual | null {
  try {
    const data =
      localStorage.getItem(getMorningRitualStorageKey()) ??
      localStorage.getItem(getLegacyMorningRitualStorageKey());
    if (!data) return null;

    const parsed = JSON.parse(data) as Partial<MorningRitual> & Record<string, unknown>;
    return {
      blockedItems: parsed.blockedItems ?? (Array.isArray(parsed['yasaklilar']) ? parsed['yasaklilar'] as string[] : []),
      skipped: parsed.skipped ?? Boolean(parsed['atlandi']),
    };
  } catch {
    return null;
  }
}

type NextStepRecord = {
  date: string;
  text: string;
};

export default function FocusPage() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState('');
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [morningRitual, setMorningRitual] = useState<MorningRitual | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const noteInputRef = useRef<HTMLInputElement>(null);
  const previousIndex = useRef(0);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const activeBoxStartedAtRef = useRef<string | null>(null);
  const activeBoxStartedMsRef = useRef<number | null>(null);
  const pauseStartedMsRef = useRef<number | null>(null);
  const pauseDurationMsRef = useRef(0);
  const recordedBoxIdsRef = useRef<Set<string>>(new Set());
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [isNotesDetailOpen, setIsNotesDetailOpen] = useState(false);
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [showIdlePauseModal, setShowIdlePauseModal] = useState(false);
  const [isEarlyExitPrompt, setIsEarlyExitPrompt] = useState(false);
  const [earlyReason, setEarlyReason] = useState<BreakReason | ''>('');
  const [earlyOther, setEarlyOther] = useState('');
  const [earlyExitError, setEarlyExitError] = useState('');
  const [earlyExitSaved, setEarlyExitSaved] = useState(false);
  const [pendingEarlyBox, setPendingEarlyBox] = useState<Box | null>(null);
  const lastActivityMsRef = useRef<number>(Date.now());
  const [finishHoldProgress, setFinishHoldProgress] = useState(0);
  const finishHoldTimerRef = useRef<number | null>(null);
  const completionTrackedRef = useRef(false);
  const isUiDimmed = idleSeconds >= 5 && !isPaused && !showIdlePauseModal;

  // Read today's boxes and all previous notes when the focus screen opens.
  useEffect(() => {
    const savedBoxes =
      localStorage.getItem(getBoxesStorageKey()) ??
      localStorage.getItem(getLegacyBoxesStorageKey());
    if (savedBoxes) {
      try {
        const parsed: Box[] = JSON.parse(savedBoxes);
        const sorted = [...parsed].sort((a, b) => a.time.localeCompare(b.time));
        setBoxes(sorted);
      } catch {
        setBoxes([]);
      }
    }
    setAllNotes(readAllNotes());
    setMorningRitual(readMorningRitual());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded || boxes.length === 0 || isFinished) return;
    localStorage.setItem(ACTIVE_SESSION_KEY, '1');
  }, [isLoaded, boxes.length, isFinished]);

  useEffect(() => {
    if (!isLoaded) return;
    if (isFinished || boxes.length === 0) {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  }, [isLoaded, isFinished, boxes.length]);

  useEffect(() => {
    return () => {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      if (finishHoldTimerRef.current !== null) {
        window.clearInterval(finishHoldTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || boxes.length === 0 || isFinished) return;

    const now = new Date();
    activeBoxStartedAtRef.current = now.toISOString();
    activeBoxStartedMsRef.current = now.getTime();
    pauseStartedMsRef.current = null;
    pauseDurationMsRef.current = 0;
  }, [isLoaded, activeIndex, boxes.length, isFinished]);

  useEffect(() => {
    if (!isLoaded || boxes.length === 0 || isFinished || isWritingNote) return;

    if (isPaused) {
      pauseStartedMsRef.current = Date.now();
      return;
    }

    if (pauseStartedMsRef.current !== null) {
      pauseDurationMsRef.current += Date.now() - pauseStartedMsRef.current;
      pauseStartedMsRef.current = null;
    }
  }, [isLoaded, boxes.length, isFinished, isWritingNote, isPaused]);

  // Re-evaluate the timer when the active box or pause state changes.
  // New boxes start from scratch; resumed boxes keep their remaining seconds.
  useEffect(() => {
    if (!isLoaded || boxes.length === 0 || isFinished || isWritingNote || isPaused) return;

    let secondsLeft: number;
    if (previousIndex.current !== activeIndex) {
      secondsLeft = boxes[activeIndex].duration * 60;
    } else {
      secondsLeft = remainingSeconds > 0 ? remainingSeconds : boxes[activeIndex].duration * 60;
    }
    previousIndex.current = activeIndex;
    setRemainingSeconds(secondsLeft);

    const interval = setInterval(() => {
      secondsLeft -= 1;
      setRemainingSeconds(secondsLeft);

      if (secondsLeft <= 0) {
        clearInterval(interval);
        finishBoxAndAdvance(boxes[activeIndex]);
      }
    }, 1000);

    return () => clearInterval(interval);
  // remainingSeconds intentionally stays outside dependencies so this effect
  // does not restart on every tick; it is only read when unpausing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, activeIndex, boxes, isFinished, isWritingNote, isPaused]);

  function recordBoxCompletion(box: Box) {
    if (recordedBoxIdsRef.current.has(box.id)) return;

    const startedAt = activeBoxStartedAtRef.current;
    const startedMs = activeBoxStartedMsRef.current;
    if (!startedAt || startedMs === null) return;

    const finished = new Date();
    const activePauseMs = pauseStartedMsRef.current === null
      ? 0
      : finished.getTime() - pauseStartedMsRef.current;
    const totalPauseMs = pauseDurationMsRef.current + activePauseMs;
    const actualDurationSeconds = Math.max(
      0,
      Math.round((finished.getTime() - startedMs - totalPauseMs) / 1000),
    );

    const completedBox: CompletedBox = {
      boxId: box.id,
      boxTitle: box.title,
      plannedDuration: box.duration,
      actualDuration: Math.max(1, Math.ceil(actualDurationSeconds / 60)),
      actualDurationSeconds,
      pauseDuration: Math.round(totalPauseMs / 1000),
      startedAt,
      finishedAt: finished.toISOString(),
      date: getTodayStamp(),
    };

    try {
      const savedCompletedBoxes = localStorage.getItem(getCompletedStorageKey());
      const existingCompletedBoxes: CompletedBox[] = savedCompletedBoxes
        ? JSON.parse(savedCompletedBoxes)
        : [];
      if (existingCompletedBoxes.some((completedBox) => completedBox.boxId === box.id)) {
        recordedBoxIdsRef.current.add(box.id);
        return;
      }
      localStorage.setItem(
        getCompletedStorageKey(),
        JSON.stringify([...existingCompletedBoxes, completedBox]),
      );
      recordedBoxIdsRef.current.add(box.id);
    } catch {
      // Ignore localStorage write failures.
    }
  }

  // Focus the note input when the note screen opens.
  useEffect(() => {
    if (isWritingNote && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [isWritingNote]);

  // Space toggles pause/resume only on the normal timer screen.
  useEffect(() => {
    if (isWritingNote || isFinished || boxes.length === 0) return;

    function handleKeydown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPaused((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isWritingNote, isFinished, boxes.length]);

  // Keep the browser tab title in sync with the current focus state.
  useEffect(() => {
    if (!isLoaded || boxes.length === 0) {
      document.title = 'TiBo';
    } else if (isFinished) {
      document.title = 'TiBo — Gün tamam';
    } else if (isPaused) {
      document.title = 'TiBo — Duraklatıldı';
    } else if (isWritingNote) {
      document.title = 'TiBo — Nerede kaldın?';
    } else {
      const duration = formatTimer(remainingSeconds);
      const title = boxes[activeIndex]?.title ?? '';
      document.title = `${duration} — ${title}`;
    }
    return () => {
      document.title = 'TiBo';
    };
  }, [isLoaded, boxes, activeIndex, remainingSeconds, isWritingNote, isFinished, isPaused]);

  // Idle detection during active timer.
  useEffect(() => {
    if (!isLoaded || boxes.length === 0 || isFinished || isWritingNote || isPaused || isEarlyExitPrompt || showIdlePauseModal) return;

    function markActivity() {
      lastActivityMsRef.current = Date.now();
      setIdleSeconds(0);
    }

    window.addEventListener('mousemove', markActivity);
    window.addEventListener('mousedown', markActivity);
    window.addEventListener('keydown', markActivity);
    window.addEventListener('touchstart', markActivity);

    const timer = window.setInterval(() => {
      const idle = Math.floor((Date.now() - lastActivityMsRef.current) / 1000);
      setIdleSeconds(idle);

      if (idle >= 120 && !isPaused) {
        setIsPaused(true);
        setShowIdlePauseModal(true);
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('mousemove', markActivity);
      window.removeEventListener('mousedown', markActivity);
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('touchstart', markActivity);
    };
  }, [isLoaded, boxes.length, isFinished, isWritingNote, isPaused, isEarlyExitPrompt, showIdlePauseModal]);

  function resumeAfterIdlePause() {
    lastActivityMsRef.current = Date.now();
    setIdleSeconds(0);
    setShowIdlePauseModal(false);
    setIsPaused(false);
  }

  function finishBoxAndAdvance(box: Box) {
    recordBoxCompletion(box);
    setIsPaused(false);

    if (activeIndex + 1 >= boxes.length) {
      setIsWritingNote(true);
      return;
    }

    setActiveIndex((prev) => prev + 1);
  }

  // Note is mandatory: save and continue only with a clear next step.
  function continueToNextBox() {
    const trimmedNote = noteText.trim();
    if (trimmedNote.length < 5) {
      setNoteError('En az 5 karakter yaz.');
      return;
    }

    const activeBox = boxes[activeIndex];
    const newNote: Note = {
      boxId: activeBox.id,
      boxTitle: activeBox.title,
      note: trimmedNote,
      finishedAt: new Date().toISOString(),
    };
    try {
      const savedNotes = localStorage.getItem(getNotesStorageKey());
      const existingNotes: Note[] = savedNotes ? JSON.parse(savedNotes) : [];
      localStorage.setItem(getNotesStorageKey(), JSON.stringify([...existingNotes, newNote]));

      const todayStamp = getTodayStamp();
      localStorage.setItem(`tibo-next-step-${todayStamp}`, trimmedNote);
      localStorage.setItem(LATEST_NEXT_STEP_KEY, trimmedNote);
      const rawHistory = localStorage.getItem(NEXT_STEP_HISTORY_KEY);
      let history: NextStepRecord[] = [];
      if (rawHistory) {
        try {
          history = JSON.parse(rawHistory) as NextStepRecord[];
        } catch {
          history = [];
        }
      }
      const safeHistory = Array.isArray(history)
        ? history.filter((item) => item && typeof item.date === 'string' && typeof item.text === 'string')
        : [];
      const updatedHistory = [...safeHistory, { date: todayStamp, text: trimmedNote }].slice(-20);
      localStorage.setItem(NEXT_STEP_HISTORY_KEY, JSON.stringify(updatedHistory));

      trackEvent('next_step_saved', {
        boxTitle: activeBox.title,
        noteLength: trimmedNote.length,
      });
    } catch {
      // Ignore localStorage write failures.
    }

    setNoteText('');
    setNoteError('');
    setIsWritingNote(false);
    setIsPaused(false);

    if (activeIndex + 1 >= boxes.length) {
      setIsFinished(true);
    } else {
      setActiveIndex((prev) => prev + 1);
    }
  }

  function finishAfterEarlyExitReason() {
    const box = pendingEarlyBox;
    if (!box) return;
    setEarlyExitSaved(true);
    window.setTimeout(() => {
      setEarlyExitSaved(false);
      setIsEarlyExitPrompt(false);
      setPendingEarlyBox(null);
      setEarlyReason('');
      setEarlyOther('');
      setEarlyExitError('');
      finishBoxAndAdvance(box);
    }, 420);
  }

  function submitEarlyExitReason() {
    if (!pendingEarlyBox) return;
    if (!earlyReason) {
      setEarlyExitError('Bir neden seç.');
      return;
    }
    if (earlyReason === 'Diğer' && earlyOther.trim().length < 3) {
      setEarlyExitError('Diğer için açıklama yaz.');
      return;
    }

    const reasonPayload = {
      boxId: pendingEarlyBox.id,
      boxTitle: pendingEarlyBox.title,
      reason: earlyReason,
      other: earlyReason === 'Diğer' ? earlyOther.trim() : null,
      remainingSeconds,
      createdAt: new Date().toISOString(),
      date: getTodayStamp(),
    };

    try {
      const key = `tibo-break-reasons-${getTodayStamp()}`;
      const existing = localStorage.getItem(key);
      const list = existing ? JSON.parse(existing) : [];
      localStorage.setItem(key, JSON.stringify([...list, reasonPayload]));
      trackEvent('break_reason_submitted', {
        reason: earlyReason,
        hasOther: earlyReason === 'Diğer',
        boxTitle: pendingEarlyBox.title,
      });
      trackEvent('session_abandoned', {
        reason: earlyReason,
        remainingSeconds,
      });
    } catch {
      // ignore localStorage failures
    }

    finishAfterEarlyExitReason();
  }

  function clearFinishHold() {
    if (finishHoldTimerRef.current !== null) {
      window.clearInterval(finishHoldTimerRef.current);
      finishHoldTimerRef.current = null;
    }
    setFinishHoldProgress(0);
  }

  function startFinishHold() {
    if (finishHoldTimerRef.current !== null) return;
    const startAt = Date.now();
    finishHoldTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startAt;
      const progress = Math.min(1, elapsed / 1200);
      setFinishHoldProgress(progress);
      if (progress >= 1) {
        clearFinishHold();
        finishActiveBoxNow();
      }
    }, 32);
  }

  async function downloadBriefingImage() {
    if (!shareCardRef.current) return;

    setIsPreparingImage(true);
    const node = shareCardRef.current;
    const previousInline = {
      position: node.style.position,
      top: node.style.top,
      left: node.style.left,
      zIndex: node.style.zIndex,
      opacity: node.style.opacity,
      pointerEvents: node.style.pointerEvents,
      transform: node.style.transform,
    };

    node.style.position = 'fixed';
    node.style.top = '0';
    node.style.left = '0';
    node.style.zIndex = '2147483647';
    node.style.opacity = '1';
    node.style.pointerEvents = 'none';
    node.style.transform = 'none';

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 220));

    try {
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1080,
        height: 1350,
        canvasWidth: 1080,
        canvasHeight: 1350,
        backgroundColor: '#000000',
      });
      const link = document.createElement('a');
      link.download = `tibo-brifing-${getTodayLabel().replace(/\s/g, '-')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Image could not be generated:', err);
    } finally {
      node.style.position = previousInline.position;
      node.style.top = previousInline.top;
      node.style.left = previousInline.left;
      node.style.zIndex = previousInline.zIndex;
      node.style.opacity = previousInline.opacity;
      node.style.pointerEvents = previousInline.pointerEvents;
      node.style.transform = previousInline.transform;
      setIsPreparingImage(false);
    }
  }

  // --- Ekranlar ---

  if (!isLoaded) {
    return (
      <main className="animate-fade-in min-h-screen tibo-focus-page flex items-center justify-center">
        <p className="tibo-meta">Yükleniyor...</p>
      </main>
    );
  }

  if (boxes.length === 0) {
    return (
      <main className="animate-fade-in min-h-screen tibo-focus-page flex flex-col items-center justify-center gap-8 px-6 text-center">
        <p className="tibo-body text-zinc-400">
          İlk görevi yaz.
        </p>
        <Link
          href="/"
          className="inline-flex h-12 w-full items-center justify-center bg-[var(--color-primary)] px-6 text-sm font-semibold text-[#020617] transition-all duration-150 hover:bg-[var(--color-primary-hover)] sm:w-auto"
        >
          Plan Kur
        </Link>
      </main>
    );
  }

  if (isFinished) {
    if (!completionTrackedRef.current) {
      completionTrackedRef.current = true;
      trackEvent('session_completed', {
        totalBoxes: boxes.length,
      });
    }

    const plannedMinutes = boxes.reduce((total, box) => total + box.duration, 0);
    const boxById = new Map(boxes.map((box) => [box.id, box]));
    const currentBoxIds = new Set(boxById.keys());
    const completedBoxes: ResolvedCompletedBox[] = readTodaysCompletedBoxes()
      .filter((completedBox) => currentBoxIds.has(completedBox.boxId))
      .map((completedBox) => {
        const fallbackBox = boxById.get(completedBox.boxId);
        const resolvedPlannedMinutes =
          Number.isFinite(completedBox.plannedDuration) && completedBox.plannedDuration > 0
            ? completedBox.plannedDuration
            : (fallbackBox?.duration ?? 0);
        const resolvedActualSeconds = resolveActualSeconds(completedBox);
        return {
          ...completedBox,
          resolvedPlannedMinutes,
          resolvedActualSeconds,
        };
      })
      .filter((completedBox) => completedBox.resolvedPlannedMinutes > 0 && completedBox.resolvedActualSeconds > 0);
    const completedBoxIds = new Set(completedBoxes.map((completedBox) => completedBox.boxId));
    const completedCount = boxes.filter((box) => completedBoxIds.has(box.id)).length;
    const actualSeconds = completedBoxes.reduce((total, completedBox) => total + completedBox.resolvedActualSeconds, 0);
    const actualMinutes = completedCount > 0
      ? Math.max(1, Math.round(actualSeconds / 60))
      : 0;
    const varianceMinutes = actualMinutes - plannedMinutes;
    const hasCriticalVariance = isCriticalVariance(plannedMinutes, actualMinutes);
    const completedPlannedMinutes = completedBoxes.reduce((total, completedBox) => total + completedBox.resolvedPlannedMinutes, 0);
    const accuracyScore = completedPlannedMinutes > 0 && actualMinutes > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((1 - Math.abs(actualMinutes - completedPlannedMinutes) / completedPlannedMinutes) * 100),
          ),
        )
      : null;
    const boxesWithVariance = completedBoxes.map((completedBox) => ({
      ...completedBox,
      variance: Math.round(
        (completedBox.resolvedActualSeconds / 60) - completedBox.resolvedPlannedMinutes,
      ),
    }));
    const mostOverrunBox = boxesWithVariance
      .filter((completedBox) => completedBox.variance > 0)
      .sort((a, b) => b.variance - a.variance)[0] ?? null;
    const mostAccurateBox = boxesWithVariance
      .sort((a, b) => Math.abs(a.variance) - Math.abs(b.variance))[0] ?? null;

    const todaysNotes: Note[] = (() => {
      try {
        const data =
          localStorage.getItem(getNotesStorageKey()) ??
          localStorage.getItem(getLegacyNotesStorageKey());
        return data ? (JSON.parse(data) as Note[]) : [];
      } catch {
        return [];
      }
    })();
    const notesWithContent = todaysNotes.filter((note) => note.note.trim().length > 0);
    const noteCount = notesWithContent.length;
    const previewNotes = notesWithContent.slice(0, 1);
    const completionPercentage = boxes.length > 0
      ? Math.round((completedCount / boxes.length) * 100)
      : 0;
    const completionRatio = boxes.length > 0 ? completedCount / boxes.length : 0;
    const correctionText =
      completionRatio >= 1
        ? 'Standart.'
        : completionRatio >= 0.6
          ? 'Eksik.'
          : 'Zayıf.';

    const boxesByDuration = [...boxes].sort((a, b) => b.duration - a.duration);
    const longestBox = boxesByDuration[0] ?? null;
    const shortestBox = boxesByDuration[boxesByDuration.length - 1] ?? null;

    return (
      <>
        {/* Visible briefing screen */}
        <main className="animate-fade-in min-h-screen tibo-page px-6 py-10 sm:py-12">
          <div className="mx-auto max-w-[760px]">
            <h1 className="tibo-h1 mb-2">Gün tamam.</h1>
            <p className="tibo-data tibo-meta mb-6">{getTodayLabel()}</p>

            <div className="mb-6 border-l-2 border-zinc-700 bg-[var(--color-surface)]/55 px-5 py-4">
              <Label className="mb-3">Yarın Düzelt</Label>
              <p className="tibo-section-title text-zinc-100">{correctionText}</p>
              <p className="tibo-meta mt-3">
                Sapma: {completedCount > 0 ? formatSignedMinutes(varianceMinutes) : '—'}.
              </p>
            </div>

            <div className="mb-6 grid grid-cols-1 sm:grid-cols-2">
              <MetricCard
                label="Tamamlanan Kutu"
                value={`${completedCount}/${boxes.length}`}
                hint={`%${completionPercentage} tamamlandı`}
              />
              <MetricCard
                label="Sapma"
                value={completedCount > 0 ? formatSignedMinutes(varianceMinutes) : '—'}
                hint={completedCount > 0 ? (varianceMinutes > 0 ? 'plan aşıldı' : varianceMinutes < 0 ? 'planın altında' : 'sapma yok') : 'ölçüm yok'}
                tone={hasCriticalVariance ? 'danger' : 'default'}
                className="sm:border-l-0"
              />
            </div>

            {previewNotes.length > 0 && (
              <div className="border-t border-zinc-900 pt-5 mb-6">
                <Label className="mb-3">Son Not</Label>
                <div className="border-l-2 border-zinc-800 pl-4">
                  <p className="tibo-body max-h-[3rem] overflow-hidden text-zinc-300">{previewNotes[0].note}</p>
                </div>
                {noteCount > 1 && (
                  <div className="mt-4 border border-[var(--color-border-soft)] bg-[var(--color-surface)]/35">
                    <button
                      type="button"
                      onClick={() => setIsNotesDetailOpen((current) => !current)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                      aria-expanded={isNotesDetailOpen}
                    >
                      <Label>Detay</Label>
                      <span className="tibo-meta text-zinc-600">
                        {isNotesDetailOpen ? 'kapat' : `+${noteCount - 1} not`}
                      </span>
                    </button>
                    {isNotesDetailOpen && (
                      <div className="border-t border-[var(--color-border-soft)] px-4 py-4">
                        <div className="space-y-3">
                          {notesWithContent.slice(1).map((note) => (
                            <div key={`${note.boxId}-${note.finishedAt}`} className="border-l border-zinc-800 pl-3">
                              <p className="tibo-meta text-zinc-600 capitalize">{note.boxTitle}</p>
                              <p className="tibo-body text-zinc-300">{note.note}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <hr className="border-zinc-800/50 mb-6" />

            <div className="flex flex-wrap gap-4">
              <Link
                href="/"
                className="inline-flex h-12 w-full items-center justify-center bg-[var(--color-primary)] px-6 text-sm font-semibold text-[#020617] transition-all duration-150 hover:bg-[var(--color-primary-hover)] sm:w-auto"
              >
                Plan Kur
              </Link>
              <Button
                onClick={() => downloadBriefingImage()}
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto"
              >
                <Download className="h-4 w-4" strokeWidth={1.75} />
                Görsel Olarak İndir
              </Button>
            </div>
          </div>
        </main>

        {/* Hidden share card: rendered in the DOM but not visible. */}
        <div
          ref={shareCardRef}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '1080px',
            height: '1350px',
            zIndex: isPreparingImage ? 2147483647 : -1,
            pointerEvents: 'none',
            opacity: isPreparingImage ? 1 : 0,
            transform: 'none',
            backgroundColor: '#000000',
            color: '#ffffff',
            fontFamily: "'Inter', sans-serif",
            padding: '80px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {/* Header: logo + date */}
          <div>
            <h1 style={{
              fontSize: '72px',
              fontWeight: 'bold',
              letterSpacing: '-0.05em',
              color: '#ffffff',
              marginBottom: '12px',
              textShadow: 'none',
            }}>
              TiBo
            </h1>
            <p style={{ fontSize: '20px', color: '#71717a' }}>
              {getTodayLabel()}
            </p>
          </div>

          {/* Middle: stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div>
              <p style={{ fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a', marginBottom: '8px' }}>
                PLANLANAN
              </p>
              <p style={{ fontSize: '48px', fontWeight: 'bold' }}>
                {formatMinutes(plannedMinutes)}
              </p>
              <p style={{ fontSize: '18px', color: '#71717a', marginTop: '4px' }}>
                {boxes.length} kutu
              </p>
            </div>

            <div>
              <p style={{ fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a', marginBottom: '8px' }}>
                GERÇEK
              </p>
              <p style={{ fontSize: '48px', fontWeight: 'bold' }}>
                {completedCount > 0 ? formatMinutes(actualMinutes) : '—'}
              </p>
              <p style={{ fontSize: '18px', color: '#71717a', marginTop: '4px' }}>
                {completedCount > 0 ? 'net süre' : 'ölçüm yok'}
              </p>
            </div>

            <div>
              <p style={{ fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a', marginBottom: '8px' }}>
                SAPMA
              </p>
              <p style={{
                fontSize: '48px',
                fontWeight: 'bold',
                color: hasCriticalVariance ? '#f87171' : '#fafafa',
              }}>
                {completedCount > 0 ? formatSignedMinutes(varianceMinutes) : '—'}
              </p>
            </div>

            <div>
              <p style={{ fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a', marginBottom: '8px' }}>
                TAHMİN DOĞRULUĞU
              </p>
              <p style={{ fontSize: '48px', fontWeight: 'bold' }}>
                {accuracyScore === null ? '—' : `%${accuracyScore}`}
              </p>
              <p style={{ fontSize: '18px', color: '#71717a', marginTop: '4px' }}>
                {completedCount} / {boxes.length} tamamlandı
              </p>
            </div>

            {mostOverrunBox && (
              <div>
                <p style={{ fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a', marginBottom: '8px' }}>
                  EN ÇOK TAŞAN
                </p>
            <p style={{ fontSize: '36px', fontWeight: 'bold', textTransform: 'capitalize' }}>
              {mostOverrunBox.boxTitle}
            </p>
                <p style={{ fontSize: '18px', color: '#f87171', marginTop: '4px' }}>
                  {formatSignedMinutes(mostOverrunBox.variance)}
                </p>
              </div>
            )}
          </div>

          {/* Footer: watermark */}
          <div style={{ borderTop: '1px solid #27272a', paddingTop: '24px', textAlign: 'center' }}>
            <p style={{ fontSize: '16px', color: '#52525b' }}>
              tibo.app · plan / gerçek / sapma
            </p>
          </div>
        </div>
      </>
    );
  }

  const activeBox = boxes[activeIndex];
  const nextBox = boxes[activeIndex + 1] ?? null;
  const isLastBox = activeIndex + 1 >= boxes.length;

  const noteForActiveBox: Note | null = allNotes
    .filter((note) => normalize(note.boxTitle) === normalize(activeBox.title))
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0] ?? null;
  const blockedItems = morningRitual?.skipped ? [] : morningRitual?.blockedItems ?? [];
  const totalBoxSeconds = activeBox.duration * 60;
  const remainingRatio = totalBoxSeconds > 0 ? remainingSeconds / totalBoxSeconds : 1;
  const progressRatio = Math.max(0, Math.min(1, 1 - remainingRatio));
  const isFinalSeconds = !isPaused && remainingSeconds <= 15;
  const timerTextClass = isPaused
    ? 'text-zinc-600'
    : isFinalSeconds
      ? 'text-red-300'
      : 'text-white';
  function finishActiveBoxNow() {
    if (remainingSeconds > 0) {
      setIsPaused(true);
      setPendingEarlyBox(activeBox);
      setIsEarlyExitPrompt(true);
      return;
    }
    finishBoxAndAdvance(activeBox);
  }

  // Note-writing screen.
  if (isWritingNote) {
    const trimmedNote = noteText.trim();
    const isNoteValid = trimmedNote.length >= 5;
    return (
      <main className="animate-fade-in flex min-h-screen flex-col items-center justify-center px-6 tibo-focus-page">
        <div className="flex w-full max-w-[640px] flex-col gap-5">
          <p className="tibo-meta">
            Biten kutu: <span className="capitalize">{activeBox.title}</span>
          </p>
          <h2 className="tibo-h1">Sonraki çalışmanda nereden devam edeceksin?</h2>
          <p className="tibo-body text-zinc-500">
            Bir sonraki adımı yaz.
          </p>
          <div className="w-full">
            <Input
              ref={noteInputRef}
              value={noteText}
              onChange={(e) => {
                setNoteText(e.target.value.slice(0, 120));
                if (noteError) setNoteError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') continueToNextBox();
              }}
              placeholder="Sonraki adımı yaz"
              maxLength={120}
              className="w-full"
            />
            <p className="tibo-meta mt-2 text-right">{noteText.length}/120</p>
            {noteError && <p className="tibo-meta mt-2 text-red-400">{noteError}</p>}
          </div>
          <div className="flex flex-col items-start gap-3">
            <Button
              onClick={continueToNextBox}
              size="lg"
              disabled={!isNoteValid}
              className="w-full sm:w-auto"
            >
              {isLastBox ? 'Günü Bitir' : 'Sonraki Kutu'}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (isEarlyExitPrompt) {
    return (
      <main className="animate-fade-in min-h-screen tibo-focus-page px-6 py-12">
        <div className="mx-auto flex min-h-[70vh] w-full max-w-[680px] flex-col justify-center gap-6">
          <h2 className="tibo-h1">Bıraktın.</h2>
          <p className="tibo-body text-zinc-400">Neden?</p>
          <div className="grid gap-3">
            {(['Odak kaybettim', 'Yanlış görev', 'Acil durum', 'Diğer'] as BreakReason[]).map((reason) => (
              <button
                key={reason}
                onClick={() => {
                  setEarlyReason(reason);
                  setEarlyExitError('');
                }}
                className={`h-11 border px-4 text-left tibo-body transition-colors ${
                  earlyReason === reason
                    ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                    : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          {earlyReason === 'Diğer' && (
            <Input
              value={earlyOther}
              onChange={(e) => {
                setEarlyOther(e.target.value.slice(0, 120));
                if (earlyExitError) setEarlyExitError('');
              }}
              placeholder="Nedeni yaz"
              className="w-full"
            />
          )}
          {earlyExitError && <p className="tibo-meta text-red-400">{earlyExitError}</p>}
          {earlyExitSaved && <p className="tibo-meta text-zinc-300">Not edildi.</p>}
          <div>
            <Button onClick={submitEarlyExitReason} size="lg">Devam et</Button>
          </div>
        </div>
      </main>
    );
  }

  // Normal timer screen.
  return (
    <main className="animate-fade-in min-h-screen text-white flex flex-col bg-[radial-gradient(circle_at_center,rgba(20,26,38,0.62),rgba(8,12,18,1)_62%)]">
      <div className={`relative flex items-center px-6 pt-6 transition-opacity duration-300 sm:px-8 ${isUiDimmed ? 'opacity-40' : 'opacity-100'}`}>
        <span className="absolute left-6 sm:left-8 text-zinc-800" aria-label="Çıkış kapalı">
          <X className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="tibo-data tibo-meta text-zinc-700">
          {activeIndex + 1}/{boxes.length} · <span className="capitalize">{activeBox.title}</span>
        </span>
      </div>

      <div className="flex flex-1 flex-col items-start justify-center gap-8 px-6 sm:px-8">
        {isPaused && (
          <p className="tibo-label text-zinc-600">Duraklatıldı</p>
        )}
        <h2 className={`max-w-full break-words font-semibold leading-[1.1] text-zinc-400 transition-opacity duration-300 ${isUiDimmed ? 'opacity-40' : 'opacity-70'} text-[clamp(28px,4vw,56px)]`}>
          <span className="capitalize">{activeBox.title}</span>
        </h2>
        <div className="tibo-panel-enter tibo-delay-2 self-start">
          <TimerDisplay className={timerTextClass}>
            {formatTimer(remainingSeconds)}
          </TimerDisplay>
        </div>
        <div className={`flex flex-col items-start gap-4 transition-opacity duration-300 sm:flex-row sm:items-center ${isUiDimmed ? 'opacity-40' : 'opacity-100'}`}>
          <Button
            onClick={() => setIsPaused(!isPaused)}
            variant="ghost"
            size="lg"
            className="w-full border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 sm:w-auto"
          >
            {isPaused ? <Play className="h-4 w-4" strokeWidth={1.75} /> : <Pause className="h-4 w-4" strokeWidth={1.75} />}
            {isPaused ? 'Devam Et' : 'Duraklat'}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="relative w-full overflow-hidden sm:w-auto"
            onMouseDown={startFinishHold}
            onMouseUp={clearFinishHold}
            onMouseLeave={clearFinishHold}
            onTouchStart={startFinishHold}
            onTouchEnd={clearFinishHold}
            onClick={(e) => e.preventDefault()}
          >
            <span
              className="absolute inset-y-0 left-0 bg-zinc-700/40"
              style={{ width: `${finishHoldProgress * 100}%` }}
            />
            <Check className="h-4 w-4" strokeWidth={1.75} />
            <span className="relative">Bitir</span>
          </Button>
        </div>
      </div>

      <div className="min-h-10 px-6 pb-8 sm:px-8 sm:pb-12" />
      <div className="fixed left-0 right-0 bottom-0 h-px bg-zinc-900">
        <div
          className={`h-full transition-[width,background-color] duration-500 ${isFinalSeconds ? 'bg-red-400' : 'bg-zinc-600'}`}
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

      {idleSeconds >= 60 && !showIdlePauseModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <p className="tibo-meta bg-zinc-950/80 px-4 py-2 text-zinc-300">Aktivite yok.</p>
        </div>
      )}

      {showIdlePauseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-6">
          <div className="w-full max-w-[420px] border border-zinc-800 bg-zinc-950 p-6">
            <h3 className="tibo-section-title mb-2">Oturum durduruldu.</h3>
            <p className="tibo-body mb-5 text-zinc-400">Aktivite algılanmadı.</p>
            <Button onClick={resumeAfterIdlePause}>Devam et</Button>
          </div>
        </div>
      )}
    </main>
  );
}
