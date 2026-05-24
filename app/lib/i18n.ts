'use client';

import { useEffect, useState } from 'react';

export type Language = 'tr' | 'en';

export const LANGUAGE_STORAGE_KEY = 'tibo-lang';

export function useLanguage(defaultLanguage: Language = 'en') {
  const [language, setLanguageState] = useState<Language>(defaultLanguage);
  const [isLanguageReady, setIsLanguageReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const initial = saved === 'tr' || saved === 'en' ? (saved as Language) : defaultLanguage;
    if (!saved) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, defaultLanguage);
    }
    setLanguageState(initial);
    setIsLanguageReady(true);
  }, [defaultLanguage]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      const next = event.newValue;
      if (next === 'tr' || next === 'en') setLanguageState(next);
    }

    function onLanguageChange(event: Event) {
      const detail = (event as CustomEvent<Language>).detail;
      if (detail === 'tr' || detail === 'en') setLanguageState(detail);
    }

    window.addEventListener('storage', onStorage);
    window.addEventListener('tibo-language-change', onLanguageChange as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('tibo-language-change', onLanguageChange as EventListener);
    };
  }, []);

  function setLanguage(nextLanguage: Language) {
    setLanguageState(nextLanguage);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    window.dispatchEvent(new CustomEvent<Language>('tibo-language-change', { detail: nextLanguage }));
  }

  return {
    language,
    isLanguageReady,
    setLanguage,
  };
}

export function tf(language: Language, trText: string, enText: string): string {
  return language === 'tr' ? trText : enText;
}
