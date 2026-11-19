import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Keyboard, MapPin, Mic, Repeat, Square, Trash2, Wand2 } from 'lucide-react';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { store, useStore, useT } from '@/data/store';
import { useSpeech, isStandalone } from '@/hooks/useSpeech';
import { parseCommand, type ParsedTask, type ParseWarning } from '@/nlp/parser';
import { speechLocales, type TKey } from '@/i18n';
import { nowInTz } from '@/lib/dates';
import { recurrenceLabel, relativeDay } from '@/lib/format';
import { cn, haptic } from '@/lib/util';
import type { Lang } from '@/lib/types';

const WARN_KEYS: Record<ParseWarning, TKey> = {
  ampm_assumed: 'warnAmpm',
  date_assumed: 'warnDateAssumed',
  date_inherited: 'warnDateInherited',
  past: 'warnPast',
  empty_title: 'warnEmptyTitle',
  no_date: 'warnNoDate',
};
// Warnings that should catch the user's eye (others are informational)
const STRONG: ParseWarning[] = ['ampm_assumed', 'past', 'empty_title', 'date_assumed'];

interface Item extends ParsedTask { key: number; categoryId: string | null }

export function VoiceSheet({ open, onClose, autoStart }: { open: boolean; onClose: () => void; autoStart?: boolean }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const categories = useStore((s) => s.categories);
  const [voiceLang, setVoiceLang] = useState<Lang>(settings.voiceLang);
  const speech = useSpeech(speechLocales[voiceLang]);
  const [stage, setStage] = useState<'input' | 'preview'>('input');
  const [items, setItems] = useState<Item[]>([]);
  const [nothing, setNothing] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const standalone = useMemo(() => isStandalone(), []);

  useEffect(() => {
    if (!open) {
      speech.stop();
      return;
    }
    setStage('input');
    setItems([]);
    setNothing(false);
    speech.setFinalText('');
    speech.setError(null);
    setVoiceLang(store.state.settings.voiceLang);
    if (autoStart && speech.supported) setTimeout(() => speech.start(''), 350);
    else if (!speech.supported) setTimeout(() => textRef.current?.focus(), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const text = speech.finalText;

  const analyze = () => {
    speech.stop();
    const full = [text, speech.interim].filter(Boolean).join(' ').trim();
    if (!full) return;
    const now = nowInTz(settings.timeZone);
    const parsed = parseCommand(full, { today: now.date, now: now.time });
    if (!parsed.length) {
      setNothing(true);
      return;
    }
    setNothing(false);
    const byKey = new Map(categories.filter((c) => c.builtin).map((c) => [c.builtin!, c.id]));
    setItems(parsed.map((p, i) => ({ ...p, key: i, categoryId: p.categoryHint ? byKey.get(p.categoryHint) ?? null : null })));
    setStage('preview');
  };

  const saveAll = async () => {
    const valid = items.filter((i) => i.title.trim());
    for (const i of valid) {
      await store.createTask({
        title: i.title.trim(), date: i.date, startTime: i.startTime, endTime: i.endTime && i.startTime && i.endTime > i.startTime ? i.endTime : null,
        location: i.location, recurrence: i.recurrence, categoryId: i.categoryId,
      });
    }
    haptic(15);
    store.toast(`${t('saved')}: ${valid.length}`);
    onClose();
  };

  const upd = (key: number, patch: Partial<Item>) =>
    setItems((list) => list.map((x) => (x.key === key ? { ...x, ...patch, warnings: x.warnings.filter((w) => !(w === 'ampm_assumed' && 'startTime' in patch) && !(w === 'empty_title' && 'title' in patch) && !((w === 'date_assumed' || w === 'date_inherited' || w === 'no_date') && 'date' in patch)) } : x)));

  const errorText = (() => {
    if (!speech.supported) return t('voiceUnsupported');
    switch (speech.error) {
      case 'denied': return t('voiceDenied');
      case 'service': return t('voiceUnsupported');
      case 'no-speech': return t('voiceNoSpeech');
      case 'network': return t('voiceNetwork');
      case 'other': return t('voiceError');
      default: return null;
    }
  })();

  const footer =
    stage === 'input' ? (
      <Button size="lg" className="w-full" disabled={!text.trim() && !speech.interim.trim()} onClick={analyze} data-testid="voice-analyze">
        <Wand2 size={18} /> {t('voiceAnalyze')}
      </Button>
    ) : (
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" onClick={() => setStage('input')} aria-label="back"><ArrowLeft size={18} /></Button>
        <Button size="lg" className="flex-1" onClick={saveAll} disabled={!items.some((i) => i.title.trim())} data-testid="voice-save">
          {t('voiceSaveAll')} ({items.filter((i) => i.title.trim()).length})
        </Button>
      </div>
    );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={stage === 'input' ? t('voiceTitle') : t('voicePreview')} footer={footer}>
      {stage === 'input' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted">{t('voiceLang')}</span>
            <div className="flex rounded-full bg-bg p-1 ring-1 ring-line dark:bg-elevated">
              {(['ru', 'uk'] as Lang[]).map((l) => (
                <button key={l} onClick={() => { speech.stop(); setVoiceLang(l); store.updateSettings({ voiceLang: l }); }}
                  className={cn('rounded-full px-3 py-1 text-[13px] font-semibold', voiceLang === l ? 'bg-accent text-accent-fg' : 'text-muted')}>
                  {l === 'ru' ? 'Русский' : 'Українська'}
                </button>
              ))}
            </div>
          </div>

          {speech.supported && (
            <div className="flex flex-col items-center gap-3 py-3">
              <button
                data-testid="mic-button"
                onClick={() => (speech.listening ? speech.stop() : speech.start(text))}
                aria-label={speech.listening ? t('voiceStop') : t('voiceStart')}
                className={cn('press relative grid h-24 w-24 place-items-center rounded-full text-white shadow-float transition',
                  speech.listening ? 'bg-danger' : 'bg-accent')}
              >
                {speech.listening && <span className="absolute inset-0 rounded-full bg-danger animate-pulse2" />}
                {speech.listening ? <Square size={30} className="relative fill-white" /> : <Mic size={38} className="relative" />}
              </button>
              <p className="text-[14px] font-medium text-muted" aria-live="polite">
                {speech.listening ? t('voiceListening') : t('voiceTapToStart')}
              </p>
            </div>
          )}

          {errorText && (
            <div className="flex gap-2.5 rounded-2xl bg-amber-500/10 p-3.5 text-[14px] leading-snug text-amber-700 dark:text-amber-300" role="alert">
              {speech.supported ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <Keyboard size={18} className="mt-0.5 shrink-0" />}
              <span>{errorText}{speech.error === 'service' && standalone ? ' ' + (settings.lang === 'uk' ? 'У режимі «на екрані Додому» iOS може блокувати розпізнавання — у Safari воно зазвичай працює.' : 'В режиме «на экране Домой» iOS может блокировать распознавание — в Safari оно обычно работает.') : ''}</span>
            </div>
          )}

          <label className="block">
            <span className="label">{t('voiceText')}</span>
            <textarea
              ref={textRef}
              data-testid="voice-text"
              className="field min-h-[130px] leading-relaxed"
              value={text + (speech.interim ? (text ? ' ' : '') + speech.interim : '')}
              readOnly={speech.listening}
              onChange={(e) => speech.setFinalText(e.target.value)}
              placeholder={t('voiceTextPlaceholder')}
            />
          </label>
          {speech.supported && <p className="text-[12.5px] text-muted">{t('voiceKeyboardTip')}</p>}
          {nothing && <p className="text-[14px] text-danger">{t('voiceNothing')}</p>}
        </div>
      ) : (
        <div className="space-y-3" data-testid="voice-preview">
          <p className="text-[13px] text-muted">{t('voiceTasksFound')}: {items.length}</p>
          {items.map((it) => {
            const strong = it.warnings.filter((w) => STRONG.includes(w));
            return (
              <div key={it.key} className={cn('rounded-2xl bg-bg p-3.5 ring-1 dark:bg-elevated', strong.length ? 'ring-amber-400/70' : 'ring-line')} data-testid="preview-item">
                <div className="flex items-start gap-2">
                  <input className="flex-1 bg-transparent text-[17px] font-semibold outline-none" value={it.title}
                    placeholder={t('titlePlaceholder')} onChange={(e) => upd(it.key, { title: e.target.value })} aria-label={t('title')} />
                  <button className="p-1 text-muted" aria-label={t('voiceDiscard')} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                    <Trash2 size={17} />
                  </button>
                </div>
                <input type="date" className="field mt-2.5 px-2.5 py-2 text-[14px]" value={it.date ?? ''} aria-label={t('date')}
                    onChange={(e) => upd(it.key, { date: e.target.value || null })} />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input type="time" className={cn('field tnum px-2.5 py-2 text-[14px]', it.warnings.includes('ampm_assumed') && 'ring-amber-400')} value={it.startTime ?? ''} aria-label={t('start')}
                    onChange={(e) => upd(it.key, { startTime: e.target.value || null })} />
                  <input type="time" className="field tnum px-2.5 py-2 text-[14px]" value={it.endTime ?? ''} aria-label={t('end')}
                    onChange={(e) => upd(it.key, { endTime: e.target.value || null })} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  <span className="font-medium text-fg/80">{relativeDay(settings.lang, it.date, store.today())}</span>
                  {it.recurrence && <span className="inline-flex items-center gap-1"><Repeat size={13} />{recurrenceLabel(settings.lang, it.recurrence)}</span>}
                  {it.location && <span className="inline-flex items-center gap-1"><MapPin size={13} />{it.location}</span>}
                  <select className="ml-auto rounded-lg bg-surface px-2 py-1 text-[13px] ring-1 ring-line dark:bg-bg" value={it.categoryId ?? ''}
                    onChange={(e) => upd(it.key, { categoryId: e.target.value || null })} aria-label={t('category')}>
                    <option value="">{t('noCategory')}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {it.warnings.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {it.warnings.map((w) => (
                      <li key={w} className={cn('flex items-center gap-1.5 text-[12.5px]', STRONG.includes(w) ? 'text-amber-600 dark:text-amber-300' : 'text-muted')}>
                        {STRONG.includes(w) && <AlertTriangle size={13} />} {t(WARN_KEYS[w])}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 truncate text-[12px] italic text-muted/80">«{it.source}»</p>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
