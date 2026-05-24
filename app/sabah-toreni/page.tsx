'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button, Input, Label } from '../components/ui';
import { trackEvent } from '../lib/analytics';
import { tf, useLanguage } from '../lib/i18n';

type MorningRitual = {
  primaryGoal: string;
  blockedItems: string[];
};

function getTodayStamp(): string {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}-${month}-${year}`;
}

function getMorningRitualStorageKey(): string {
  return `tibo-toren-${getTodayStamp()}`;
}

export default function MorningRitualPage() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage('en');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [blockedItems, setBlockedItems] = useState<string[]>([]);
  const [blockedItemInput, setBlockedItemInput] = useState('');
  const [error, setError] = useState('');

  function addBlockedItem() {
    if (!blockedItemInput.trim()) return;
    setBlockedItems((previousItems) => [...previousItems, blockedItemInput.trim()]);
    setBlockedItemInput('');
    setError('');
  }

  function removeBlockedItem(index: number) {
    setBlockedItems((previousItems) => previousItems.filter((_, itemIndex) => itemIndex !== index));
  }

  function completeRitual() {
    if (!primaryGoal.trim()) {
      setError(tf(language, 'Önce tek işi yaz.', 'Write one task first.'));
      return;
    }

    const finalBlockedItems = blockedItemInput.trim()
      ? [...blockedItems, blockedItemInput.trim()]
      : blockedItems;

    if (finalBlockedItems.length === 0) {
      setError(tf(language, 'En az bir engel yaz.', 'Write at least one blocker.'));
      return;
    }

    const ritual: MorningRitual = {
      primaryGoal,
      blockedItems: finalBlockedItems,
    };
    localStorage.setItem(getMorningRitualStorageKey(), JSON.stringify(ritual));
    trackEvent('plan_created', {
      blockedCount: ritual.blockedItems.length,
      hasGoal: ritual.primaryGoal.trim().length > 0,
    });
    router.push('/');
  }

  const t = {
    language: tf(language, 'DİL / LANGUAGE', 'LANGUAGE / DİL'),
    singleTask: tf(language, 'Tek görevi yaz.', 'Write one task.'),
    singleTaskPlaceholder: tf(language, 'tek görev', 'single task'),
    blockersTitle: tf(language, 'Odak engellerini yaz.', 'Write focus blockers.'),
    blockersSub: tf(language, 'Bu görev sırasında bu kaçışlara izin yok.', 'No escape routes during this task.'),
    blockersScientificNote: tf(
      language,
      'Not: Dikkat dağıtıcıları önceden tanımlamak, blok sırasında bilişsel yükü ve dürtüsel görev geçişini azaltır.',
      'Note: Predefining distractions reduces cognitive load and impulsive task switching during the block.',
    ),
    remove: tf(language, 'Kaldır', 'Remove'),
    trapPlaceholder: tf(language, 'tuzak', 'blocker'),
    addTrap: tf(language, 'Tuzak ekle', 'Add blocker'),
    lockBlock: tf(language, 'Bloğu Kilitle', 'Lock Block'),
    step1: tf(language, 'Aşama 1 / 2', 'Step 1 / 2'),
    step2: tf(language, 'Aşama 2 / 2', 'Step 2 / 2'),
  };

  return (
    <main className="min-h-screen tibo-page tibo-ritual-compact">
      <div className="tibo-ritual-shell animate-fade-in">

        {/* Header */}
        <div className="tibo-ritual-top">
          <span className="tibo-ref-logo">TiBo<span>.</span></span>
          <div className="flex items-center gap-3">
            <span className="tibo-label">{t.language}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as 'tr' | 'en')}
              aria-label="Language"
              className="h-10 border border-[var(--color-border-soft)] bg-[rgba(4,8,13,0.54)] px-3 text-[11px] font-semibold tracking-[0.08em] text-zinc-300"
            >
              <option value="en">EN</option>
              <option value="tr">TR</option>
            </select>
          </div>
        </div>

        <section className="tibo-ritual-panel">
          <div className="mb-6">
            <Label>{tf(language, 'Odak Kurulumu', 'Focus Setup')}</Label>
          </div>

          <div className="space-y-7">
            <div>
              <p className="tibo-meta mb-2 uppercase tracking-[0.12em] text-[var(--color-primary)]/85">{t.step1}</p>
              <h1 className="tibo-screen-title mb-3">{t.singleTask}</h1>
              <Input
                type="text"
                placeholder={t.singleTaskPlaceholder}
                spellCheck={false}
                value={primaryGoal}
                onChange={(e) => {
                  setPrimaryGoal(e.target.value);
                  if (error) setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') completeRitual(); }}
                autoFocus
                className="w-full"
              />
            </div>

            <div>
              <p className="tibo-meta mb-2 uppercase tracking-[0.12em] text-[var(--color-primary)]/85">{t.step2}</p>
              <h2 className="tibo-section-title mb-2.5">{t.blockersTitle}</h2>
              <p className="tibo-body mb-2.5">{t.blockersSub}</p>
              <p className="tibo-meta mb-4 text-[var(--color-text-muted)]/90 italic">
                {t.blockersScientificNote}
              </p>

              {blockedItems.length > 0 && (
                <div className="mb-4 flex flex-col gap-1.5">
                  {blockedItems.map((item, index) => (
                    <div
                      key={index}
                      className="animate-slide-in flex min-h-10 items-center justify-between border border-[var(--color-border-soft)] bg-[rgba(12,15,15,0.62)] px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="h-5 w-[2px] shrink-0 bg-[var(--color-primary)]" />
                        <span className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{item}</span>
                      </div>
                      <Button
                        onClick={() => removeBlockedItem(index)}
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 px-0 py-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        aria-label={t.remove}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_3.35rem] sm:items-stretch">
                <Input
                  type="text"
                  placeholder={t.trapPlaceholder}
                  spellCheck={false}
                  value={blockedItemInput}
                  onChange={(e) => {
                    setBlockedItemInput(e.target.value);
                    if (error) setError('');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') addBlockedItem(); }}
                  className="h-[var(--tibo-control-height)] min-w-0"
                />
                <Button
                  onClick={addBlockedItem}
                  disabled={!blockedItemInput.trim()}
                  variant="secondary"
                  size="md"
                  className="h-[var(--tibo-control-height)] w-full px-0 text-[var(--color-primary)] sm:w-[var(--tibo-control-height)]"
                  aria-label={t.addTrap}
                  title={t.addTrap}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                </Button>
              </div>
            </div>
          </div>

          {error && <p className="tibo-meta mt-5 text-[var(--color-danger)]">{error}</p>}

          <Button
            onClick={completeRitual}
            size="lg"
            className="mt-6 w-full"
          >
            {t.lockBlock}
          </Button>
        </section>

      </div>
    </main>
  );
}
