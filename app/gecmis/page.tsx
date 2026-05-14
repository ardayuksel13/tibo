'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Label } from '../components/ui';

type Box = {
  id: string;
  title: string;
  duration: number;
  time: string;
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

type CompletionType = 'completed' | 'early_exit';

type Note = {
  boxId: string;
  boxTitle: string;
  note: string;
  finishedAt: string;
};

type MorningRitual = {
  primaryGoal: string;
  deepWorkStart: string;
  deepWorkEnd: string;
  blockedItems: string[];
  skipped?: boolean;
};

type DayData = {
  date: Date;
  dateKey: string;
  boxes: Box[];
  completed: CompletedBox[];
  notes: Note[];
  ritual: MorningRitual | null;
};

const BOXES_PREFIX = 'tibo-boxes-';
const COMPLETED_PREFIX = 'tibo-completed-';
const NOTES_PREFIX = 'tibo-notes-';
const RITUAL_PREFIX = 'tibo-toren-';

function formatMinutes(min: number): string {
  if (min === 0) return '0dk';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}s ${m}dk`;
  if (h > 0) return `${h}s`;
  return `${m}dk`;
}

function resolveActualSeconds(completedBox: CompletedBox): number {
  const fromSeconds = completedBox.actualDurationSeconds;
  if (Number.isFinite(fromSeconds) && (fromSeconds ?? 0) > 0) return fromSeconds as number;
  return Math.round(completedBox.actualDuration * 60);
}

function isReliableCompletion(plannedSeconds: number, actualSeconds: number): boolean {
  if (plannedSeconds <= 0 || actualSeconds <= 0) return false;
  const remainingSeconds = plannedSeconds - actualSeconds;
  const remainingRatio = remainingSeconds / plannedSeconds;

  return actualSeconds / plannedSeconds >= 0.5 || remainingSeconds <= 15 || remainingRatio <= 0.1;
}

function isReliableCompletedBox(completedBox: CompletedBox): boolean {
  if (completedBox.completionType) return completedBox.completionType === 'completed';
  return isReliableCompletion(completedBox.plannedDuration * 60, resolveActualSeconds(completedBox));
}

function isValidBox(box: Box): boolean {
  return Boolean(
    box &&
    typeof box.id === 'string' &&
    typeof box.title === 'string' &&
    box.title.trim().length > 0 &&
    Number.isFinite(box.duration) &&
    box.duration > 0 &&
    /^\d{2}:\d{2}$/.test(box.time),
  );
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

function parseDateKey(key: string, prefix: string): Date | null {
  const datePart = key.replace(prefix, '');
  if (!/^\d{2}-\d{2}-\d{4}$/.test(datePart)) return null;

  const [day, month, year] = datePart.split('-').map(Number);
  if (!day || !month || !year) return null;

  const currentYear = new Date().getFullYear();
  if (year < 2020 || year > currentYear + 1) return null;

  const parsedDate = new Date(year, month - 1, day);
  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate;
}

function formatDateLong(d: Date): string {
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${days[d.getDay()]}`;
}

function formatDateKey(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function getCompletedForPlannedBoxes(boxes: Box[], completed: CompletedBox[]): CompletedBox[] {
  if (boxes.length === 0) return [];
  const boxIds = new Set(boxes.map((box) => box.id));
  return completed.filter((item) => boxIds.has(item.boxId));
}

function getReliableCompletedForPlannedBoxes(boxes: Box[], completed: CompletedBox[]): CompletedBox[] {
  return getCompletedForPlannedBoxes(boxes, completed).filter(isReliableCompletedBox);
}

function HistoryMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <Label className="mb-2">{label}</Label>
      <p className="tibo-data truncate text-lg font-bold text-zinc-100">{value}</p>
      {hint && <p className="tibo-meta mt-1 truncate text-zinc-700">{hint}</p>}
    </div>
  );
}

export default function HistoryPage() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [days, setDays] = useState<DayData[]>([]);

  useEffect(() => {
    const dateKeys = Object.keys(localStorage)
      .filter((key) => key.startsWith(BOXES_PREFIX))
      .map((key) => ({
        storageKey: key,
        date: parseDateKey(key, BOXES_PREFIX),
      }))
      .filter((item): item is { storageKey: string; date: Date } => item.date !== null)
      .map((item) => ({
        date: item.date,
        dateKey: formatDateKey(item.date),
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const historyDays = dateKeys
      .map(({ date, dateKey }) => {
        const boxes = readJson<Box[]>(`${BOXES_PREFIX}${dateKey}`, []).filter(isValidBox);
        const completed = readJson<CompletedBox[]>(`${COMPLETED_PREFIX}${dateKey}`, []).filter(isValidCompletedBox);
        const notes = readJson<Note[]>(`${NOTES_PREFIX}${dateKey}`, []).filter((note) => note.note.trim().length > 0);

        return {
          date,
          dateKey,
          boxes,
          completed,
          notes,
          ritual: readJson<MorningRitual | null>(`${RITUAL_PREFIX}${dateKey}`, null),
        };
      })
      .filter((day) => day.boxes.length > 0 || getCompletedForPlannedBoxes(day.boxes, day.completed).length > 0 || day.notes.length > 0);

    setDays(historyDays);
    setIsLoaded(true);
  }, []);

  if (!isLoaded) {
    return (
      <main className="animate-fade-in min-h-screen tibo-page flex items-center justify-center px-6">
        <p className="tibo-meta">Yükleniyor...</p>
      </main>
    );
  }

  return (
    <main className="animate-fade-in min-h-screen tibo-page px-6 py-10 sm:py-12">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-10 flex items-center justify-between">
          <Link
            href="/"
            className="tibo-meta hover:text-white transition-colors duration-200"
          >
            ← Anasayfa
          </Link>
          <p className="tibo-data tibo-meta">{days.length} oturum kaydı</p>
        </div>

        <header className="mb-8 border-b border-[var(--color-border-soft)] pb-6">
          <h1 className="tibo-h1 mb-4 text-white">Geçmiş</h1>
          <p className="tibo-body text-zinc-500">Görev, süre, sonuç.</p>
        </header>

        {days.length === 0 ? (
          <div className="min-h-[45vh] flex flex-col items-center justify-center text-center">
            <h2 className="tibo-section-title mb-4">Veri yok.</h2>
            <p className="tibo-meta mb-6">Kutu bitir. Kayıt açılır.</p>
            <p className="tibo-body text-zinc-300 max-w-md">
              Görev başlat. Çalış.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
	            {days.map((day) => {
	              const plannedCount = day.boxes.length;
	              const completedForDay = getReliableCompletedForPlannedBoxes(day.boxes, day.completed);
	              const completedCount = completedForDay.length;
	              const earlyClosedCount = getCompletedForPlannedBoxes(day.boxes, day.completed).filter(
	                (completedBox) => !isReliableCompletedBox(completedBox),
	              ).length;
	              const totalActualMinutes = Math.round(
	                completedForDay.reduce(
	                  (sum, item) => sum + (resolveActualSeconds(item) / 60),
	                  0,
	                ),
	              );
	              const completedLabel = plannedCount > 0 ? `${completedCount} / ${plannedCount}` : '—';
              const primaryGoal = day.ritual && !day.ritual.skipped ? day.ritual.primaryGoal : null;

              return (
                <article
                  key={day.dateKey}
                  className="tibo-card p-4 transition-colors duration-150 hover:border-zinc-700/80 sm:p-5"
                >
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="tibo-data tibo-meta mb-2 text-zinc-700">{day.dateKey}</p>
                      <h2 className="tibo-section-title truncate text-zinc-100">
                        {formatDateLong(day.date)}
                      </h2>
                      <p className="tibo-body mt-2 truncate capitalize text-zinc-500">
                        {primaryGoal ?? '—'}
                      </p>
                    </div>
                    <div className="grid shrink-0 grid-cols-1 gap-4 text-left sm:grid-cols-2 sm:gap-6 sm:text-right">
	                      <HistoryMetric
	                        label="Tamamlanan"
	                        value={completedLabel}
	                        hint={earlyClosedCount > 0 ? `${earlyClosedCount} erken` : undefined}
	                      />
	                      <HistoryMetric label="Odak Süresi" value={totalActualMinutes > 0 ? formatMinutes(totalActualMinutes) : '—'} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
