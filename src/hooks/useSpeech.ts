import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typings for the Web Speech API (not in TS DOM lib).
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string; message?: string }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SR;

export type SpeechError = 'unsupported' | 'denied' | 'no-speech' | 'network' | 'service' | 'other';

export function getRecognitionCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * Browser speech recognition (Safari on iOS/iPadOS 14.5+, Chrome, Edge).
 * Text is accumulated across restarts so users can pause and continue.
 */
export function useSpeech(lang: string) {
  const [supported] = useState(() => !!getRecognitionCtor());
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<SpeechError | null>(null);
  const recRef = useRef<SR | null>(null);
  const baseRef = useRef('');
  const wantRef = useRef(false);

  const stop = useCallback(() => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const start = useCallback((existingText: string) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) { setError('unsupported'); return; }
    setError(null);
    try { recRef.current?.abort(); } catch { /* ignore */ }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    baseRef.current = existingText.trim();
    let sessionFinal = '';
    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let interimText = '';
      sessionFinal = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) sessionFinal += r[0].transcript + ' ';
        else interimText += r[0].transcript;
      }
      const combined = [baseRef.current, sessionFinal.trim()].filter(Boolean).join(' ');
      setFinalText(combined);
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      const map: Record<string, SpeechError> = {
        'not-allowed': 'denied', 'service-not-allowed': 'service', 'no-speech': 'no-speech',
        network: 'network', 'audio-capture': 'denied', aborted: 'other', 'language-not-supported': 'service',
      };
      const code = map[e.error] ?? 'other';
      if (e.error !== 'aborted') setError(code);
      if (code !== 'no-speech') wantRef.current = false;
    };
    rec.onend = () => {
      setListening(false);
      setInterim((cur) => {
        // Safari sometimes ends without marking the last chunk final: keep it.
        if (cur.trim()) setFinalText((f) => [f, cur.trim()].filter(Boolean).join(' '));
        return '';
      });
      recRef.current = null;
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
    } catch {
      setError('other');
      setListening(false);
    }
  }, [lang]);

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* ignore */ } }, []);

  return { supported, listening, finalText, interim, error, start, stop, setFinalText, setError };
}
