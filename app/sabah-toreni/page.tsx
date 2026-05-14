'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button, Input, Label } from '../components/ui';
import { trackEvent } from '../lib/analytics';

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
  const [step, setStep] = useState(1);
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

  function skipRitual() {
    localStorage.setItem(getMorningRitualStorageKey(), JSON.stringify({ skipped: true }));
    router.push('/');
  }

  function goToBlockedItemsStep() {
    if (!primaryGoal.trim()) {
      setError('Önce tek işi yaz.');
      return;
    }
    setError('');
    setStep(2);
  }

  function completeRitual() {
    const finalBlockedItems = blockedItemInput.trim()
      ? [...blockedItems, blockedItemInput.trim()]
      : blockedItems;

    if (finalBlockedItems.length === 0) {
      setError('En az bir engel yaz.');
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

  return (
    <main className="min-h-screen tibo-page">
      <div key={step} className="animate-fade-in mx-auto max-w-[720px] px-6 py-10 sm:py-12">

        {/* Header: progress + skip */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="tibo-data tibo-meta">{step}/2</span>
          <Label className="text-zinc-600">Odak Kurulumu</Label>
          <div className="flex gap-2">
            {[1, 2].map((item) => (
              <span
                key={item}
                className={`h-1.5 w-1.5 rounded-none ${
                  item === step
                    ? 'bg-[var(--color-primary)] shadow-[0_0_3px_rgba(22,132,255,0.15)]'
                    : item < step
                      ? 'bg-zinc-700'
                      : 'bg-zinc-900'
                }`}
              />
            ))}
          </div>
          <Button
            onClick={skipRitual}
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-[11px] font-normal text-zinc-700 hover:text-zinc-500"
          >
            Akışı Atla
          </Button>
        </div>

        {/* Step 1: primary goal */}
        {step === 1 && (
          <>
            <h1 className="tibo-h1 mb-5">
              Tek görevi yaz.
            </h1>
            <Input
              type="text"
              placeholder="tek görev"
              value={primaryGoal}
              onChange={(e) => {
                setPrimaryGoal(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') goToBlockedItemsStep(); }}
              autoFocus
              className="mb-4 w-full text-lg"
            />
            {error && <p className="tibo-meta mb-8 text-red-400">{error}</p>}
            <Button
              onClick={goToBlockedItemsStep}
              size="lg"
              className="w-full sm:w-auto"
            >
              Kaçışları Kapat
            </Button>
          </>
        )}

        {/* Step 2: blocked items */}
        {step === 2 && (
          <>
            <h1 className="tibo-screen-title mb-4">
              Odak engellerini yaz.
            </h1>
            <p className="tibo-body mb-6 text-zinc-500">
              Bu görev sırasında bu kaçışlara izin yok.
            </p>
            {/* Current blocked items */}
            {blockedItems.length > 0 && (
              <div className="mb-6 flex flex-col gap-2">
                {blockedItems.map((item, index) => (
                  <div
                    key={index}
                    className="animate-slide-in flex min-h-12 items-center justify-between border border-[rgba(148,163,184,0.14)] bg-[rgba(4,8,13,0.58)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-5 w-[2px] shrink-0 bg-[var(--color-primary)] shadow-[0_0_3px_rgba(22,132,255,0.13)]" />
                      <span className="truncate text-[15px] font-medium text-zinc-100">{item}</span>
                    </div>
                    <Button
                      onClick={() => removeBlockedItem(index)}
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 px-0 py-0 text-zinc-700 hover:text-zinc-400"
                      aria-label="Kaldır"
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* New blocked item input */}
            <div className="mb-8 grid gap-2 sm:grid-cols-[minmax(0,1fr)_3.5rem] sm:items-stretch">
              <Input
                type="text"
                placeholder="tuzak"
                value={blockedItemInput}
                onChange={(e) => {
                  setBlockedItemInput(e.target.value);
                  if (error) setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') addBlockedItem(); }}
                className="h-[var(--tibo-control-height)] min-w-0 border-[rgba(148,163,184,0.18)] bg-[rgba(4,8,13,0.58)]"
              />
              <Button
                onClick={addBlockedItem}
                disabled={!blockedItemInput.trim()}
                variant="secondary"
                size="md"
                className="h-[var(--tibo-control-height)] w-full border-[rgba(148,163,184,0.18)] bg-[rgba(4,8,13,0.58)] px-0 text-[var(--color-primary)] hover:border-[var(--color-primary-line)] hover:bg-[rgba(10,14,21,0.78)] sm:w-[var(--tibo-control-height)]"
                aria-label="Tuzak ekle"
                title="Tuzak ekle"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
            {error && <p className="tibo-meta mb-8 text-red-400">{error}</p>}

            <Button
              onClick={completeRitual}
              size="lg"
              className="w-full sm:w-auto"
            >
              Bloğu Kilitle
            </Button>
          </>
        )}

      </div>
    </main>
  );
}
