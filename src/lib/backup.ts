import type { Category, Task } from './types';

export function toCsv(tasks: Task[], categories: Category[]): string {
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const head = ['title', 'description', 'date', 'start', 'end', 'category', 'priority', 'location', 'repeat', 'subtasks', 'done', 'favorite', 'created'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = tasks.filter((t) => !t.deleted).map((t) => [
    t.title, t.description, t.date ?? '', t.startTime ?? '', t.endTime ?? '', t.categoryId ? cat.get(t.categoryId) ?? '' : '',
    t.priority, t.location, t.recurrence ? JSON.stringify(t.recurrence) : '', t.subtasks.map((s) => (s.done ? '[x] ' : '[ ] ') + s.title).join(' | '),
    t.recurrence ? t.doneDates.join(' ') : t.completedAt ?? '', t.favorite ? 1 : 0, t.createdAt,
  ].map(esc).join(','));
  return '﻿' + [head.join(','), ...rows].join('\r\n');
}

export async function saveFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  // iOS home-screen apps cannot download files directly: use the share sheet ("Save to Files").
  if (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
