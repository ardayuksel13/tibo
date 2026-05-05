export type TiBoEventName =
  | 'first_task_started'
  | 'session_completed'
  | 'session_abandoned'
  | 'break_reason_submitted'
  | 'next_step_saved'
  | 'plan_created'
  | 'return_next_day';

type EventPayload = Record<string, unknown>;

const EVENT_LOG_KEY = 'tibo-analytics-events';
const ANALYTICS_ENDPOINT = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
const ANALYTICS_PROVIDER = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const PLAUSIBLE_API = 'https://plausible.io/api/event';

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function postWithBeacon(url: string, body: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  try {
    const blob = new Blob([body], { type: 'application/json' });
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
}

function forwardEvent(event: { name: TiBoEventName; payload: EventPayload; createdAt: string }): void {
  if (typeof window === 'undefined') return;
  const body = safeStringify(event);

  if (ANALYTICS_ENDPOINT && ANALYTICS_ENDPOINT.trim().length > 0) {
    const sent = postWithBeacon(ANALYTICS_ENDPOINT, body);
    if (!sent) {
      void fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // Analytics forwarding must never break user flow.
      });
    }
  }

  if (ANALYTICS_PROVIDER === 'plausible' && PLAUSIBLE_DOMAIN) {
    const plausiblePayload = safeStringify({
      domain: PLAUSIBLE_DOMAIN,
      name: event.name,
      url: window.location.href,
      props: event.payload,
    });
    const sent = postWithBeacon(PLAUSIBLE_API, plausiblePayload);
    if (!sent) {
      void fetch(PLAUSIBLE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: plausiblePayload,
        keepalive: true,
      }).catch(() => {
        // Ignore analytics network errors.
      });
    }
  }
}

export function trackEvent(name: TiBoEventName, payload: EventPayload = {}): void {
  if (typeof window === 'undefined') return;

  const event = {
    name,
    payload,
    createdAt: new Date().toISOString(),
  };

  try {
    const existingRaw = localStorage.getItem(EVENT_LOG_KEY);
    const existing = existingRaw ? (JSON.parse(existingRaw) as typeof event[]) : [];
    const next = [...existing, event].slice(-500);
    localStorage.setItem(EVENT_LOG_KEY, JSON.stringify(next));
  } catch {
    // Analytics must never break product flow.
  }

  forwardEvent(event);
}
