'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button, Card, Input, Label } from '../components/ui';
import { trackEvent } from '../lib/analytics';

type MorningRitual = {
  primaryGoal: string;
  deepWorkStart: string;
  deepWorkEnd: string;
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
  const [deepWorkStart, setDeepWorkStart] = useState('09:00');
  const [deepWorkEnd, setDeepWorkEnd] = useState('11:00');
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

  function goToDeepWorkStep() {
    if (!primaryGoal.trim()) {
      setError('Önce tek işi yaz.');
      return;
    }
    setError('');
    setStep(2);
  }

  function goToBlockedItemsStep() {
    if (!deepWorkStart || !deepWorkEnd) {
      setError('Saat aralığı seç.');
      return;
    }
    setError('');
    setStep(3);
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
      deepWorkStart,
      deepWorkEnd,
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
          <span className="tibo-data tibo-meta">{step}/3</span>
          <Label>Odak Planlama</Label>
          <div className="flex gap-2">
            {[1, 2, 3].map((item) => (
              <span
                key={item}
                className={`h-2 w-2 rounded-none ${item <= step ? 'bg-zinc-300' : 'bg-zinc-800'}`}
              />
            ))}
          </div>
          <Button
            onClick={skipRitual}
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-[11px] font-normal text-zinc-700 hover:text-zinc-500"
          >
            Planı Atla
          </Button>
        </div>

        {/* Step 1: primary goal */}
        {step === 1 && (
          <>
            <h1 className="tibo-h1 mb-6">
              Bugünün tek işi ne?
            </h1>
            <Input
              type="text"
              placeholder="tek işi yaz"
              value={primaryGoal}
              onChange={(e) => {
                setPrimaryGoal(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') goToDeepWorkStep(); }}
              autoFocus
              className="mb-4 w-full"
            />
            {error && <p className="tibo-meta mb-8 text-red-400">{error}</p>}
            <Button
              onClick={goToDeepWorkStep}
              size="lg"
              variant="secondary"
              className="w-full sm:w-auto"
            >
              Saat Seç
            </Button>
          </>
        )}

        {/* Step 2: deep work hours */}
        {step === 2 && (
          <>
            <h1 className="tibo-h1 mb-4">
              Derin iş hangi saatlerde?
            </h1>
            <p className="tibo-body mb-8 text-zinc-500">
              Bu aralıkta tek iş.
            </p>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Input
                type="time"
                value={deepWorkStart}
                onChange={(e) => {
                  setDeepWorkStart(e.target.value);
                  if (error) setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') goToBlockedItemsStep(); }}
                className="w-full font-tibo-mono sm:w-40"
                aria-label="Derin iş başlangıç saati"
                title="Derin iş başlangıç saati"
              />
              <span className="hidden sm:inline tibo-meta">—</span>
              <Input
                type="time"
                value={deepWorkEnd}
                onChange={(e) => {
                  setDeepWorkEnd(e.target.value);
                  if (error) setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') goToBlockedItemsStep(); }}
                className="w-full font-tibo-mono sm:w-40"
                aria-label="Derin iş bitiş saati"
                title="Derin iş bitiş saati"
              />
            </div>
            {error && <p className="tibo-meta mb-8 text-red-400">{error}</p>}
            <Button
              onClick={goToBlockedItemsStep}
              size="lg"
              variant="secondary"
              className="w-full sm:w-auto"
            >
              Engelleri Seç
            </Button>
          </>
        )}

        {/* Step 3: blocked items */}
        {step === 3 && (
          <>
            <h1 className="mb-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] text-zinc-50 sm:text-[40px]">
              Odaklanmanı engelleyecek şeyler neler?
            </h1>
            <p className="tibo-body mb-6 text-zinc-500">
              Engeli önce yaz.
            </p>
            {/* Current blocked items */}
            {blockedItems.length > 0 && (
              <div className="flex flex-col gap-2 mb-6">
                {blockedItems.map((item, index) => (
                  <Card
                    key={index}
                    className="animate-slide-in flex items-center justify-between px-4 py-4"
                  >
                    <span className="text-white text-base">{item}</span>
                    <Button
                      onClick={() => removeBlockedItem(index)}
                      variant="ghost"
                      size="sm"
                      className="h-auto px-2 py-2 text-zinc-700 hover:text-red-500"
                      aria-label="Kaldır"
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                  </Card>
                ))}
              </div>
            )}

            {/* New blocked item input */}
            <div className="flex gap-2 mb-8">
              <Input
                type="text"
                placeholder="engeli yaz"
                value={blockedItemInput}
                onChange={(e) => {
                  setBlockedItemInput(e.target.value);
                  if (error) setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') addBlockedItem(); }}
                className="flex-1"
              />
              <Button
                onClick={addBlockedItem}
                disabled={!blockedItemInput.trim()}
                variant="secondary"
                size="md"
                aria-label="Engel ekle"
                title="Engel ekle"
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
              Planı Kaydet
            </Button>
          </>
        )}

      </div>
    </main>
  );
}
