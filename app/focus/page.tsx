'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { toPng } from 'html-to-image';
import { Check, Download, Pause, Play } from 'lucide-react';
import { Button, Input, Label, TimerDisplay } from '../components/ui';
import { trackEvent } from '../lib/analytics';
import { tf, useLanguage } from '../lib/i18n';

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
  completionType?: CompletionType;
};

type ResolvedCompletedBox = CompletedBox & {
  resolvedPlannedMinutes: number;
  resolvedActualSeconds: number;
  resolvedCompletionType: CompletionType;
};

type MorningRitual = {
  blockedItems: string[];
  skipped?: boolean;
};

type BreakReason = 'lost_focus' | 'wrong_task' | 'urgent' | 'other';
type CompletionType = 'completed' | 'early_exit';
const ACTIVE_SESSION_KEY = 'tibo-active-session';
const LATEST_NEXT_STEP_KEY = 'tibo-next-step-latest';
const NEXT_STEP_HISTORY_KEY = 'tibo-next-step-history';


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

function getTodayLabel(language: 'tr' | 'en'): string {
  return new Intl.DateTimeFormat(language === 'tr' ? 'tr-TR' : 'en-US', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).format(new Date());
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
  const { language } = useLanguage('en');
  const [isLoaded, setIsLoaded] = useState(false);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState('');
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
  const [isEarlyExitPrompt, setIsEarlyExitPrompt] = useState(false);
  const [earlyReason, setEarlyReason] = useState<BreakReason | ''>('');
  const [earlyOther, setEarlyOther] = useState('');
  const [earlyExitError, setEarlyExitError] = useState('');
  const [earlyExitSaved, setEarlyExitSaved] = useState(false);
  const [pendingEarlyBox, setPendingEarlyBox] = useState<Box | null>(null);
  const [finishHoldProgress, setFinishHoldProgress] = useState(0);
  const finishHoldTimerRef = useRef<number | null>(null);
  const completionTrackedRef = useRef(false);
  const t = {
    loading: tf(language, 'Yükleniyor...', 'Loading...'),
    firstTask: tf(language, 'İlk görevi yaz.', 'Write the first task.'),
    newTask: tf(language, 'Yeni Görev', 'New Task'),
    completed: tf(language, 'Görev tamam.', 'Task complete.'),
    blockClosed: tf(language, 'Blok kapandı.', 'Block closed.'),
    taskIncomplete: tf(language, 'Görev yarım kaldı.', 'Task left incomplete.'),
    planApplied: tf(language, 'Planı uyguladın.', 'Plan executed.'),
    blockCompleted: tf(language, 'Blok tamamlandı.', 'Block completed.'),
    dataMissing: tf(language, 'Veri eksik.', 'Missing data.'),
    tomorrowFix: tf(language, 'Yarın Düzelt', 'Fix Tomorrow'),
    variance: tf(language, 'Sapma', 'Variance'),
    earlyCloseCount: tf(language, 'Erken kapanan blok', 'Early closed blocks'),
    box: tf(language, 'Kutu', 'Boxes'),
    actualDuration: tf(language, 'Gerçek Süre', 'Actual Time'),
    lastNote: tf(language, 'Son Not', 'Last Note'),
    download: tf(language, 'Görsel Olarak İndir', 'Download Visual'),
    endedBlock: tf(language, 'Biten blok', 'Ended block'),
    continuation: tf(language, 'Devam noktası.', 'Continuation point.'),
    continuationSub: tf(language, 'Bir sonraki blok buradan açılır.', 'Next block opens from here.'),
    continuationPlaceholder: tf(language, 'Nereden devam edeceksin?', 'Where will you continue?'),
    lockable: tf(language, 'Devam noktası kilitlenebilir.', 'Continuation point is lockable.'),
    min5: tf(language, 'En az 5 karakter yaz.', 'Write at least 5 characters.'),
    saveContinuation: tf(language, 'Devam Noktasını Kaydet', 'Save Continuation Point'),
    youLeft: tf(language, 'Bıraktın.', 'You stopped.'),
    why: tf(language, 'Neden?', 'Why?'),
    whySub: tf(language, 'Sebebi kaydet. Bir sonraki blokta düzelt.', 'Save the reason. Fix it in the next block.'),
    reasonPlaceholder: tf(language, 'Nedeni yaz', 'Write reason'),
    noted: tf(language, 'Not edildi.', 'Logged.'),
    saveReason: tf(language, 'Sebebi Kaydet', 'Save Reason'),
    paused: tf(language, 'Duraklatıldı', 'Paused'),
    pause: tf(language, 'Duraklat', 'Pause'),
    resume: tf(language, 'Devam Et', 'Resume'),
    holdToEnd: tf(language, 'Basılı Tutarak Sonlandır', 'Hold To End'),
    endBlock: tf(language, 'Bloğu Sonlandır', 'End Block'),
    exitLocked: tf(language, 'Çıkış kapalı', 'Exit locked'),
    reasonPick: tf(language, 'Bir neden seç.', 'Pick a reason.'),
    reasonOther: tf(language, 'Diğer için açıklama yaz.', 'Add details for Other.'),
  };
  const breakReasonOptions: Array<{ key: BreakReason; label: string }> = [
    { key: 'lost_focus', label: tf(language, 'Odak kaybettim', 'Lost focus') },
    { key: 'wrong_task', label: tf(language, 'Yanlış görev', 'Wrong task') },
    { key: 'urgent', label: tf(language, 'Acil durum', 'Urgent issue') },
    { key: 'other', label: tf(language, 'Diğer', 'Other') },
  ];

  // Read today's boxes and ritual context when the focus screen opens.
  useEffect(() => {
    const shouldOpenDayEnd = window.location.search.includes('gunSonu=1');
    const savedBoxes =
      localStorage.getItem(getBoxesStorageKey()) ??
      localStorage.getItem(getLegacyBoxesStorageKey());
    if (savedBoxes) {
      try {
        const parsed: Box[] = JSON.parse(savedBoxes);
        const sorted = [...parsed].sort((a, b) => a.time.localeCompare(b.time));
        const completedBoxIds = new Set(readTodaysCompletedBoxes().map((completedBox) => completedBox.boxId));
        const firstOpenBoxIndex = sorted.findIndex((box) => !completedBoxIds.has(box.id));
        setBoxes(sorted);
        setActiveIndex(firstOpenBoxIndex >= 0 ? firstOpenBoxIndex : 0);
        if (!shouldOpenDayEnd && sorted.length > 0 && firstOpenBoxIndex === -1) {
          setIsFinished(true);
          localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
      } catch {
        setBoxes([]);
      }
    }
    setMorningRitual(readMorningRitual());
    if (shouldOpenDayEnd) {
      setIsFinished(true);
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
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
    const plannedSeconds = box.duration * 60;
    const completionType = resolveCompletionType(plannedSeconds, actualDurationSeconds);

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
      completionType,
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
      document.title = `TiBo — ${t.completed}`;
    } else if (isPaused) {
      document.title = `TiBo — ${t.paused}`;
    } else if (isWritingNote) {
      document.title = `TiBo — ${t.continuation}`;
    } else {
      const duration = formatTimer(remainingSeconds);
      const title = boxes[activeIndex]?.title ?? '';
      document.title = `${duration} — ${title}`;
    }
    return () => {
      document.title = 'TiBo';
    };
  }, [isLoaded, boxes, activeIndex, remainingSeconds, isWritingNote, isFinished, isPaused, t.completed, t.paused, t.continuation]);

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
      setNoteError(t.min5);
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
      setEarlyExitError(t.reasonPick);
      return;
    }
    if (earlyReason === 'other' && earlyOther.trim().length < 3) {
      setEarlyExitError(t.reasonOther);
      return;
    }

    const reasonPayload = {
      boxId: pendingEarlyBox.id,
      boxTitle: pendingEarlyBox.title,
      reason: earlyReason,
      other: earlyReason === 'other' ? earlyOther.trim() : null,
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
        hasOther: earlyReason === 'other',
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
      link.download = `tibo-briefing-${getTodayLabel(language).replace(/\s/g, '-')}.png`;
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
        <p className="tibo-meta">{t.loading}</p>
      </main>
    );
  }

  if (boxes.length === 0) {
    return (
      <main className="animate-fade-in min-h-screen tibo-focus-page flex flex-col items-center justify-center gap-8 px-6 text-center">
        <p className="tibo-body text-zinc-400">
          {t.firstTask}
        </p>
        <Link
          href="/"
          className="tibo-primary inline-flex h-14 w-full items-center justify-center px-6 text-sm font-semibold transition-all duration-150 sm:w-auto"
        >
          {t.newTask}
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

    const plannedSeconds = boxes.reduce((total, box) => total + (box.duration * 60), 0);
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
	        const resolvedPlannedSeconds = resolvedPlannedMinutes * 60;
	        return {
	          ...completedBox,
	          resolvedPlannedMinutes,
	          resolvedActualSeconds,
	          resolvedCompletionType: resolveCompletionType(
	            resolvedPlannedSeconds,
	            resolvedActualSeconds,
	            completedBox.completionType,
	          ),
	        };
	      })
	      .filter((completedBox) => completedBox.resolvedPlannedMinutes > 0 && completedBox.resolvedActualSeconds > 0);
	    const reliableCompletedBoxes = completedBoxes.filter((completedBox) => completedBox.resolvedCompletionType === 'completed');
	    const earlyClosedBoxes = completedBoxes.filter((completedBox) => completedBox.resolvedCompletionType === 'early_exit');
	    const completedBoxIds = new Set(reliableCompletedBoxes.map((completedBox) => completedBox.boxId));
	    const completedCount = boxes.filter((box) => completedBoxIds.has(box.id)).length;
	    const earlyClosedCount = earlyClosedBoxes.length;
	    const completedPlannedMinutes = reliableCompletedBoxes.reduce((total, completedBox) => total + completedBox.resolvedPlannedMinutes, 0);
	    const completedPlannedSeconds = completedPlannedMinutes * 60;
	    const actualSeconds = reliableCompletedBoxes.reduce((total, completedBox) => total + completedBox.resolvedActualSeconds, 0);
	    const earlyActualSeconds = earlyClosedBoxes.reduce((total, completedBox) => total + completedBox.resolvedActualSeconds, 0);
	    const varianceSeconds = completedCount > 0 ? actualSeconds - completedPlannedSeconds : 0;
	    const earlyVarianceSeconds = earlyClosedCount > 0 ? earlyActualSeconds - plannedSeconds : 0;
	    const useSecondPrecision = completedCount > 0
	      ? shouldUseSecondPrecision(completedPlannedSeconds, actualSeconds)
	      : shouldUseSecondPrecision(plannedSeconds, earlyActualSeconds);
	    const varianceDisplay = completedCount > 0
	      ? formatSignedDurationSeconds(varianceSeconds, useSecondPrecision)
	      : earlyClosedCount > 0
	        ? formatSignedDurationSeconds(earlyVarianceSeconds, useSecondPrecision)
	        : '—';
	    const plannedDisplay = formatDurationSeconds(plannedSeconds, useSecondPrecision);
	    const actualDisplay = completedCount > 0
	      ? formatDurationSeconds(actualSeconds, useSecondPrecision)
	      : earlyClosedCount > 0
	        ? formatDurationSeconds(earlyActualSeconds, useSecondPrecision)
	        : '—';
    const toleranceSeconds = Math.max(3, Math.round(completedPlannedSeconds * 0.05));
    const isWithinTolerance = completedCount > 0 && Math.abs(varianceSeconds) <= toleranceSeconds;
    const hasCriticalVariance =
      completedCount > 0 &&
      !isWithinTolerance &&
      isCriticalVariance(completedPlannedSeconds / 60, actualSeconds / 60);
    const accuracyScore = completedPlannedSeconds > 0 && actualSeconds > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((1 - Math.abs(actualSeconds - completedPlannedSeconds) / completedPlannedSeconds) * 100),
          ),
        )
      : null;
	    const boxesWithVariance = reliableCompletedBoxes.map((completedBox) => ({
	      ...completedBox,
	      varianceSeconds: completedBox.resolvedActualSeconds - (completedBox.resolvedPlannedMinutes * 60),
	    }));
    const mostOverrunBox = boxesWithVariance
      .filter((completedBox) => completedBox.varianceSeconds > 0)
      .sort((a, b) => b.varianceSeconds - a.varianceSeconds)[0] ?? null;

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
	    const completionRatio = boxes.length > 0 ? completedCount / boxes.length : 0;
	    const briefingTitle = earlyClosedCount > 0 ? t.blockClosed : t.completed;
	    const correctionText =
	      earlyClosedCount > 0
	        ? t.taskIncomplete
	        : completionRatio >= 1 && isWithinTolerance
	          ? t.planApplied
	          : completedCount > 0
	            ? t.blockCompleted
	            : t.dataMissing;

    return (
      <>
        {/* Visible briefing screen */}
        <main className="animate-fade-in min-h-screen tibo-page tibo-closeout-screen px-6 py-10 sm:py-12">
          <div className="mx-auto max-w-[1240px] tibo-closeout-shell">
            <h1 className="tibo-h1 mb-3">{briefingTitle}</h1>
            <p className="tibo-data tibo-meta mb-7">{getTodayLabel(language)}</p>

            <section className="mb-7 border-l-2 border-zinc-700 bg-[rgba(4,8,13,0.42)] px-6 py-6">
	              <p className="tibo-section-title text-zinc-100">{correctionText}</p>
              <div className="mt-4 flex items-center gap-2">
                <Label className="text-zinc-600">{t.tomorrowFix}</Label>
                <span className="h-px flex-1 bg-zinc-900" />
              </div>
              <p className="tibo-meta mt-3 text-zinc-500">
                {t.variance}: {varianceDisplay}.
              </p>
              {earlyClosedCount > 0 && (
                <p className="tibo-meta mt-2 text-zinc-600">
                  {t.earlyCloseCount}: {earlyClosedCount}.
                </p>
              )}
	            </section>

            <section className="mb-7 grid grid-cols-1 border-y border-zinc-900 sm:grid-cols-3">
              <div className="py-4 sm:pr-4">
                <Label className="mb-3 text-zinc-600">{t.box}</Label>
                <p className="tibo-data text-[1.35rem] font-bold text-zinc-100">{completedCount}/{boxes.length}</p>
              </div>
              <div className="border-t border-zinc-900 py-4 sm:border-l sm:border-t-0 sm:px-4">
                <Label className="mb-3 text-zinc-600">{t.actualDuration}</Label>
                <p className="tibo-data text-[1.35rem] font-bold text-zinc-100">{actualDisplay}</p>
              </div>
              <div className="border-t border-zinc-900 py-4 sm:border-l sm:border-t-0 sm:pl-4">
                <Label className="mb-3 text-zinc-600">{t.variance}</Label>
                <p className={`tibo-data break-words text-[1.35rem] font-bold ${hasCriticalVariance ? 'text-red-300' : 'text-zinc-100'}`}>
                  {varianceDisplay}
                </p>
              </div>
            </section>

            {previewNotes.length > 0 && (
              <section className="mb-7">
                <Label className="mb-3">{t.lastNote}</Label>
                <div className="border-l-2 border-[var(--color-primary)]/55 bg-[rgba(4,8,13,0.34)] px-4 py-4">
                  <p className="tibo-body max-h-[3rem] overflow-hidden text-zinc-300">{previewNotes[0].note}</p>
                </div>
              </section>
            )}

            <div className="flex flex-col gap-3 border-t border-zinc-900 pt-6 sm:flex-row sm:items-center">
              <Link
                href="/"
                className="tibo-primary inline-flex h-14 w-full items-center justify-center px-6 text-sm font-semibold transition-all duration-150 sm:w-auto"
              >
                {t.newTask}
              </Link>
              <Button
                onClick={() => downloadBriefingImage()}
                variant="ghost"
                size="sm"
                className="h-10 w-full px-0 text-zinc-600 hover:text-zinc-300 sm:w-auto sm:px-4"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t.download}
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
              {getTodayLabel(language)}
            </p>
          </div>

          {/* Middle: stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div>
              <p style={{ fontSize: '14px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a', marginBottom: '8px' }}>
                PLANLANAN
              </p>
	              <p style={{ fontSize: '48px', fontWeight: 'bold' }}>
	                {plannedDisplay}
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
	                {actualDisplay}
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
	                {varianceDisplay}
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
	              {earlyClosedCount > 0 && (
	                <p style={{ fontSize: '18px', color: '#f87171', marginTop: '4px' }}>
	                  {earlyClosedCount} erken kapanan
	                </p>
	              )}
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
	                  {formatSignedDurationSeconds(
	                    mostOverrunBox.varianceSeconds,
	                    shouldUseSecondPrecision(mostOverrunBox.resolvedPlannedMinutes * 60, mostOverrunBox.resolvedActualSeconds),
	                  )}
                </p>
              </div>
            )}
          </div>

          {/* Footer: watermark */}
          <div style={{ borderTop: '1px solid #27272a', paddingTop: '24px', textAlign: 'center' }}>
            <p style={{ fontSize: '16px', color: '#52525b' }}>
              tibo.app · görev / süre / sonuç
            </p>
          </div>
        </div>
      </>
    );
  }

  const activeBox = boxes[activeIndex];
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
    const isNearNaturalEnd = remainingSeconds <= 15 || remainingRatio <= 0.1;
    if (remainingSeconds > 0 && !isNearNaturalEnd) {
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
      <main className="animate-fade-in flex min-h-screen items-center px-6 py-12 text-white tibo-focus-page tibo-bridge-screen">
        <div className="mx-auto grid w-full max-w-[1120px] gap-7 tibo-bridge-shell">
          <div className="grid gap-4">
            <p className="tibo-meta text-zinc-600">
              {t.endedBlock}: <span className="capitalize text-zinc-400">{activeBox.title}</span>
            </p>
            <h2 className="tibo-screen-title max-w-[720px]">
              {t.continuation}
            </h2>
            <p className="tibo-body max-w-[520px] text-zinc-500">
              {t.continuationSub}
            </p>
          </div>

          <div className="grid gap-3">
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
              placeholder={t.continuationPlaceholder}
              maxLength={120}
              spellCheck={false}
              className="w-full text-lg"
            />
            <div className="flex items-center justify-between gap-4">
              <p className="tibo-meta text-zinc-600">
                {isNoteValid ? t.lockable : t.min5}
              </p>
              <p className="tibo-meta text-zinc-700">{noteText.length}/120</p>
            </div>
            {noteError && <p className="tibo-meta mt-2 text-red-400">{noteError}</p>}
          </div>

          <div className="pt-1">
            <Button
              onClick={continueToNextBox}
              size="lg"
              disabled={!isNoteValid}
              className="w-full sm:w-auto min-w-[320px]"
            >
              {t.saveContinuation}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (isEarlyExitPrompt) {
    const canSubmitEarlyExitReason = earlyReason !== null && (earlyReason !== 'other' || earlyOther.trim().length > 0);

    return (
      <main className="animate-fade-in flex min-h-screen items-center px-6 py-12 text-white tibo-focus-page tibo-abandon-screen">
        <div className="mx-auto grid w-full max-w-[1120px] gap-7 tibo-abandon-shell">
          <div className="grid gap-3">
            <h2 className="tibo-h1">{t.youLeft}</h2>
            <div className="grid gap-1">
              <p className="tibo-body text-zinc-400">{t.why}</p>
              <p className="tibo-meta text-zinc-600">{t.whySub}</p>
            </div>
          </div>

          <div className="grid gap-2">
            {breakReasonOptions.map((reason) => (
              <button
                key={reason.key}
                onClick={() => {
                  setEarlyReason(reason.key);
                  setEarlyExitError('');
                }}
                className={`group flex h-12 items-center gap-3 border px-4 text-left text-[13px] font-semibold uppercase tracking-[0.1em] transition-colors focus:outline-none ${
                  earlyReason === reason.key
                    ? 'border-[var(--color-primary-line)] bg-[rgba(9,16,26,0.82)] text-zinc-100'
                    : 'border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.014)] text-zinc-300 hover:border-[rgba(148,163,184,0.24)] hover:bg-[rgba(255,255,255,0.03)] hover:text-zinc-100'
                }`}
              >
                <span
                  className={`h-5 w-[2px] shrink-0 transition-colors ${
                    earlyReason === reason.key
                      ? 'bg-[var(--color-primary)]'
                      : 'bg-zinc-700 group-hover:bg-zinc-500'
                  }`}
                />
                {reason.label}
              </button>
            ))}
          </div>

          {earlyReason === 'other' && (
            <Input
              value={earlyOther}
              onChange={(e) => {
                setEarlyOther(e.target.value.slice(0, 120));
                if (earlyExitError) setEarlyExitError('');
              }}
              placeholder={t.reasonPlaceholder}
              spellCheck={false}
              className="h-[var(--tibo-control-height)] w-full"
            />
          )}
          {earlyExitError && <p className="tibo-meta text-red-400">{earlyExitError}</p>}
          {earlyExitSaved && <p className="tibo-meta text-zinc-300">{t.noted}</p>}
          <div className="pt-1">
            <Button
              onClick={submitEarlyExitReason}
              size="lg"
              disabled={!canSubmitEarlyExitReason}
              className="w-full disabled:border-[rgba(148,163,184,0.12)] disabled:bg-[rgba(255,255,255,0.018)] disabled:text-zinc-700 sm:w-auto min-w-[280px]"
            >
              {t.saveReason}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Normal timer screen.
  return (
	    <main className="animate-fade-in relative flex min-h-screen flex-col overflow-hidden text-white tibo-focus-page">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(24,31,42,0.42),rgba(3,6,9,0)_46%)]" />

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-10 sm:px-8">
        <section className="grid w-full max-w-[1180px] justify-items-center gap-8 text-center">
          <div className="grid justify-items-center gap-3 transition-opacity duration-300">
            {isPaused && (
              <p className="tibo-label text-zinc-600">{t.paused}</p>
            )}
            <h2 className="max-w-[760px] break-words text-[clamp(20px,2.3vw,30px)] font-extrabold leading-[1.14] text-[rgba(244,241,234,0.92)]">
              <span className="capitalize">{activeBox.title}</span>
            </h2>
            {blockedItems.length > 0 && (
              <div className="flex max-w-[760px] flex-wrap items-center justify-center gap-2">
                {blockedItems.map((item) => (
                  <span
                    key={item}
                    className="border border-[rgba(148,163,184,0.12)] bg-[rgba(4,8,13,0.48)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-600"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="tibo-panel-enter tibo-delay-2">
            <TimerDisplay className={`tibo-operation-timer ${timerTextClass}`}>
              {formatTimer(remainingSeconds)}
            </TimerDisplay>
          </div>

          <div className="grid w-full max-w-[540px] grid-cols-1 gap-3 transition-opacity duration-300 sm:grid-cols-[1fr_1.25fr]">
            <Button
              onClick={() => setIsPaused(!isPaused)}
              variant="ghost"
              size="lg"
              className="h-14 w-full border border-[rgba(148,163,184,0.12)] bg-[rgba(255,255,255,0.015)] text-[12px] font-extrabold uppercase tracking-[0.14em] text-zinc-500 hover:border-zinc-700 hover:bg-[rgba(255,255,255,0.025)] hover:text-zinc-200"
            >
              {isPaused ? <Play className="h-4 w-4" strokeWidth={1.75} /> : <Pause className="h-4 w-4" strokeWidth={1.75} />}
              {isPaused ? t.resume : t.pause}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="relative h-14 w-full overflow-hidden border-[rgba(239,68,68,0.16)] bg-[rgba(255,255,255,0.012)] text-[12px] font-extrabold uppercase tracking-[0.14em] text-zinc-500 shadow-none hover:border-[rgba(239,68,68,0.28)] hover:bg-[rgba(40,10,12,0.08)] hover:text-red-200"
              style={{
                borderColor: finishHoldProgress > 0
                  ? `rgba(239,68,68,${0.22 + finishHoldProgress * 0.48})`
                  : undefined,
              }}
              onMouseDown={startFinishHold}
              onMouseUp={clearFinishHold}
              onMouseLeave={clearFinishHold}
              onTouchStart={startFinishHold}
              onTouchEnd={clearFinishHold}
              onClick={(e) => e.preventDefault()}
            >
              <span
                className="absolute inset-y-0 left-0 bg-red-500/8 transition-[width] duration-75"
                style={{ width: `${finishHoldProgress * 100}%` }}
              />
              <span
                className="absolute bottom-0 left-0 h-[2px] bg-red-400 transition-[width] duration-75"
                style={{ width: `${finishHoldProgress * 100}%` }}
              />
              <Check
                className={`relative h-4 w-4 transition-colors duration-150 ${finishHoldProgress > 0 ? 'text-red-300' : 'text-zinc-600'}`}
                strokeWidth={1.75}
              />
              <span className={`relative transition-colors duration-150 ${finishHoldProgress > 0 ? 'text-red-200' : ''}`}>
                {finishHoldProgress > 0.7 ? t.endBlock : t.holdToEnd}
              </span>
            </Button>
          </div>
        </section>
      </div>

      <div className="fixed left-0 right-0 bottom-0 h-px bg-zinc-900">
        <div
          className={`h-full transition-[width,background-color] duration-500 ${isFinalSeconds ? 'bg-red-400' : 'bg-zinc-700'}`}
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

    </main>
  );
}
