import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MockSupabase } from './mock-supabase';

const EMAIL = 'owner@example.com';
const PASSWORD = 'correct-horse-42';

async function signUp(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: /Первый запуск/ }).click();
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('today-weekday')).toBeVisible();
}

async function signIn(page: Page) {
  await page.goto('./');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('today-weekday')).toBeVisible();
}

async function addTask(page: Page, title: string, opts: { time?: string } = {}) {
  await page.getByTestId('add-task').click();
  await page.getByTestId('task-title').fill(title);
  if (opts.time) await page.getByTestId('task-start').fill(opts.time);
  await page.getByTestId('save-task').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function syncNow(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(700);
}

let mock: MockSupabase;
test.beforeEach(async ({ context }) => {
  mock = new MockSupabase();
  await mock.attach(context);
});

test('first setup creates the account; a second registration is refused', async ({ page, browser }) => {
  await signUp(page);
  await expect(page.getByText('Свободный день')).toBeVisible();
  expect(mock.users).toHaveLength(1);

  const other = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
  await mock.attach(other);
  const p2 = await other.newPage();
  await p2.goto('./');
  await p2.getByRole('button', { name: /Первый запуск/ }).click();
  await p2.getByTestId('login-email').fill('intruder@example.com');
  await p2.getByTestId('login-password').fill('another-pass-1');
  await p2.getByTestId('login-submit').click();
  await expect(p2.getByRole('alert')).toContainText('Регистрация закрыта');
  await p2.getByRole('button', { name: /уже есть аккаунт/ }).click();
  await p2.getByTestId('login-email').fill(EMAIL);
  await p2.getByTestId('login-password').fill('wrong-password');
  await p2.getByTestId('login-submit').click();
  await expect(p2.getByRole('alert')).toContainText('Неверный email или пароль');
  await other.close();
});

test('manual task: create, edit, complete, reopen, duplicate, delete', async ({ page }) => {
  await signUp(page);
  await addTask(page, 'Купить хлеб', { time: '23:50' });
  const card = page.getByTestId('task-card').filter({ hasText: 'Купить хлеб' });
  await expect(card.first()).toBeVisible();
  await expect(page.getByTestId('planned-count')).toHaveText('1');

  // edit
  await card.first().click();
  await page.getByTestId('task-title').fill('Купить хлеб и молоко');
  await page.getByTestId('save-task').click();
  await expect(page.getByTestId('task-card').filter({ hasText: 'Купить хлеб и молоко' }).first()).toBeVisible();

  // complete from the list
  await page.getByTestId('task-card').filter({ hasText: 'Купить хлеб и молоко' }).first().getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByTestId('done-count')).toHaveText('1');
  await expect(page.getByText('Выполнено сегодня · 1')).toBeVisible();

  // reopen
  await page.getByTestId('task-card').filter({ hasText: 'Купить хлеб и молоко' }).first().getByRole('button', { name: 'Вернуть в активные' }).click();
  await expect(page.getByTestId('done-count')).toHaveText('0');

  // duplicate
  await page.getByTestId('task-card').filter({ hasText: 'Купить хлеб и молоко' }).first().click();
  await page.getByRole('button', { name: 'Дублировать' }).click();
  await expect(page.getByTestId('planned-count')).toHaveText('2');

  // delete
  await page.getByTestId('task-card').filter({ hasText: 'Купить хлеб и молоко' }).first().click();
  await page.getByTestId('delete-task').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('planned-count')).toHaveText('1');

  // synced to the (mock) cloud
  await syncNow(page);
  await expect.poll(() => [...mock.tables.tasks.values()].filter((r) => !r.deleted).length).toBe(1);
  await expect.poll(() => [...mock.tables.tasks.values()].filter((r) => r.deleted).length).toBe(1);
});

test('voice planning: several tasks from one phrase with dates, times and repeat', async ({ page }) => {
  await signUp(page);
  await page.getByTestId('voice-cta').click();
  // Headless Chromium has no microphone, so the recognised text is typed – exactly
  // what the user can also do with the iOS keyboard dictation button.
  await page.getByTestId('voice-text').fill(
    'Завтра в девять утра мне нужно быть в областной больнице. Потом в одиннадцать тридцать встреча с коллегами. Вечером в семь заехать в магазин. В пятницу в десять утра записан к стоматологу. И каждую среду в шесть вечера у меня английский',
  );
  await page.getByTestId('voice-analyze').click();
  const items = page.getByTestId('preview-item');
  await expect(items).toHaveCount(5);
  await expect(items.nth(0).getByLabel('Название')).toHaveValue('Быть в областной больнице');
  await expect(items.nth(0).getByLabel('Начало')).toHaveValue('09:00');
  await expect(items.nth(1).getByLabel('Начало')).toHaveValue('11:30');
  await expect(items.nth(2).getByLabel('Начало')).toHaveValue('19:00');
  await expect(items.nth(4)).toContainText('Каждую неделю');
  // user can fix a field before saving
  await items.nth(1).getByLabel('Название').fill('Встреча с коллегами (офис)');
  await page.getByTestId('voice-save').click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByTestId('tab-calendar').click();
  await page.getByRole('tab', { name: 'Неделя' }).click();
  // tomorrow may be in next week: walk forward if needed
  const week = page.getByTestId('week-view');
  if (!(await week.getByText('Быть в областной больнице').count())) await page.getByRole('button', { name: 'next' }).click();
  await expect(page.getByTestId('week-view').getByText('Быть в областной больнице')).toBeVisible();
  await expect(page.getByTestId('week-view').getByText('Встреча с коллегами (офис)')).toBeVisible();
  await syncNow(page);
  await expect.poll(() => mock.tables.tasks.size).toBe(5);
});

test('recurring task appears on following days; completing one day does not complete others', async ({ page }) => {
  await signUp(page);
  await page.getByTestId('add-task').click();
  await page.getByTestId('task-title').fill('Зарядка');
  await page.getByRole('button', { name: 'Больше полей' }).click();
  await page.getByTestId('task-repeat').selectOption('daily');
  await page.getByTestId('save-task').click();
  await page.getByTestId('task-card').filter({ hasText: 'Зарядка' }).first().getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByTestId('done-count')).toHaveText('1');
  await page.getByTestId('tab-calendar').click();
  await page.getByRole('tab', { name: 'Неделя' }).click();
  await page.getByRole('button', { name: 'next' }).click();
  // 7 occurrences next week, none completed
  await expect(page.getByTestId('week-view').getByTestId('task-card').filter({ hasText: 'Зарядка' })).toHaveCount(7);
  await expect(page.getByTestId('week-view').getByRole('button', { name: 'Вернуть в активные' })).toHaveCount(0);
});

test('calendar: day / week / month views, navigation and drag to another day', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
  await mock.attach(ctx);
  const page = await ctx.newPage();
  await signUp(page);
  await page.getByTestId('add-task').click();
  await page.getByTestId('task-title').fill('Перетаскиваемая задача');
  await page.getByTestId('task-start').fill('10:00');
  await page.getByTestId('save-task').click();
  await page.getByTestId('side-calendar').click();

  await page.getByRole('tab', { name: 'День' }).click();
  await expect(page.getByTestId('day-grid').getByText('Перетаскиваемая задача')).toBeVisible();
  await page.getByRole('tab', { name: 'Месяц' }).click();
  await expect(page.getByTestId('month-view')).toBeVisible();
  await page.getByRole('tab', { name: 'Неделя' }).click();

  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date()));
  const d = new Date(today + 'T12:00:00Z');
  const isLastDayOfWeek = d.getUTCDay() === 0; // Sunday, week starts Monday
  d.setUTCDate(d.getUTCDate() + (isLastDayOfWeek ? -1 : 1));
  const target = d.toISOString().slice(0, 10);

  const card = page.getByTestId('week-view').getByTestId('task-card').filter({ hasText: 'Перетаскиваемая задача' });
  const box = (await card.boundingBox())!;
  const dest = (await page.getByTestId(`week-day-${target}`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 5 });
  await page.mouse.move(dest.x + dest.width / 2, dest.y + 120, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByTestId(`week-day-${target}`).getByText('Перетаскиваемая задача')).toBeVisible();

  // navigation
  const before = await page.getByTestId('calendar-title').textContent();
  await page.getByRole('button', { name: 'next' }).click();
  await expect(page.getByTestId('calendar-title')).not.toHaveText(before!);
  await page.getByTestId('cal-today').click();
  await expect(page.getByTestId('calendar-title')).toHaveText(before!);
  await ctx.close();
});

async function device(browser: import('@playwright/test').Browser, name: 'iPhone 13' | 'iPad Pro 11') {
  const ctx = await browser.newContext({ ...devices[name], locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
  await mock.attach(ctx);
  return { ctx, page: await ctx.newPage() };
}

test('sync: created on iPhone appears on iPad; completed on iPad shows on iPhone', async ({ browser }) => {
  const iphone = await device(browser, 'iPhone 13');
  const ipad = await device(browser, 'iPad Pro 11');
  await signUp(iphone.page);
  await addTask(iphone.page, 'Задача с iPhone', { time: '23:55' });
  await syncNow(iphone.page);
  await expect.poll(() => [...mock.tables.tasks.values()].some((r) => r.title === 'Задача с iPhone')).toBe(true);

  await expect.poll(() => mock.tables.categories.size).toBe(7); // default categories uploaded once

  await signIn(ipad.page);
  await syncNow(ipad.page);
  expect(mock.tables.categories.size).toBe(7); // no duplicates from the second device
  await expect(ipad.page.getByTestId('task-card').filter({ hasText: 'Задача с iPhone' }).first()).toBeVisible();
  await ipad.page.getByTestId('task-card').filter({ hasText: 'Задача с iPhone' }).first().getByRole('button', { name: 'Завершить' }).click();
  await syncNow(ipad.page);
  await expect.poll(() => [...mock.tables.tasks.values()].find((r) => r.title === 'Задача с iPhone')?.completed_at).toBeTruthy();

  await syncNow(iphone.page);
  await expect(iphone.page.getByTestId('done-count')).toHaveText('1');
  await iphone.ctx.close();
  await ipad.ctx.close();
});

test('offline: app opens without network, changes are queued and sent after reconnect', async ({ page, context }) => {
  await signUp(page);
  await addTask(page, 'Онлайн задача');
  // wait until the service worker controls the page (offline cache ready)
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('task-card').filter({ hasText: 'Онлайн задача' }).first()).toBeVisible();
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await addTask(page, 'Офлайн задача');
  await expect(page.getByTestId('offline-banner')).toContainText('Ожидают отправки: 1');
  expect([...mock.tables.tasks.values()].some((r) => r.title === 'Офлайн задача')).toBe(false);

  await context.setOffline(false);
  await syncNow(page);
  await expect.poll(() => [...mock.tables.tasks.values()].some((r) => r.title === 'Офлайн задача')).toBe(true);
  await expect(page.getByTestId('offline-banner')).toBeHidden();
});

test('conflicting edits on two devices are shown to the user, not silently overwritten', async ({ browser }) => {
  const a = await device(browser, 'iPhone 13');
  const b = await device(browser, 'iPad Pro 11');
  await signUp(a.page);
  await addTask(a.page, 'Общая задача', { time: '23:58' });
  await syncNow(a.page);
  await signIn(b.page);
  await expect(b.page.getByTestId('task-card').filter({ hasText: 'Общая задача' }).first()).toBeVisible();

  await b.ctx.setOffline(true);
  await a.page.getByTestId('task-card').filter({ hasText: 'Общая задача' }).first().click();
  await a.page.getByTestId('task-title').fill('Версия iPhone');
  await a.page.getByTestId('save-task').click();
  await syncNow(a.page);
  await expect.poll(() => [...mock.tables.tasks.values()][0]?.title).toBe('Версия iPhone');

  await b.page.getByTestId('task-card').filter({ hasText: 'Общая задача' }).first().click();
  await b.page.getByTestId('task-title').fill('Версия iPad');
  await b.page.getByTestId('save-task').click();
  await b.ctx.setOffline(false);
  await syncNow(b.page);
  await b.page.getByRole('button', { name: /конфликт/ }).click();
  await expect(b.page.getByText('Версия iPad')).toBeVisible();
  await b.page.getByRole('button', { name: 'Оставить версию с этого устройства' }).click();
  await syncNow(b.page);
  await expect.poll(() => [...mock.tables.tasks.values()][0]?.title).toBe('Версия iPad');
  await a.ctx.close();
  await b.ctx.close();
});

test('iPhone layout: bottom tab bar, no horizontal scroll, safe-area aware', async ({ page }) => {
  await signUp(page);
  await expect(page.getByTestId('tab-today')).toBeVisible();
  await expect(page.getByTestId('tab-mic')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const vp = await page.evaluate(() => document.querySelector('meta[name=viewport]')!.getAttribute('content'));
  expect(vp).toContain('viewport-fit=cover');
});

test('iPad layout: sidebar navigation instead of tab bar', async ({ browser }) => {
  const { ctx, page } = await device(browser, 'iPad Pro 11');
  await signUp(page);
  await expect(page.getByTestId('side-calendar')).toBeVisible();
  await expect(page.getByTestId('tab-today')).toBeHidden();
  for (const r of ['stats', 'settings', 'search', 'archive', 'favorites', 'inbox']) {
    await page.getByTestId(`side-${r}`).click();
    await expect(page.locator('h1').first()).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

test('PWA: manifest, icons and service worker are valid for "Add to Home Screen"', async ({ page, request }) => {
  await page.goto('./');
  const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await (await request.get(new URL(manifestHref!, page.url()).toString())).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/myday-planner/');
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const i of manifest.icons) expect((await request.get(new URL(i.src, page.url()).toString())).ok()).toBe(true);
  expect((await request.get('apple-touch-icon.png')).ok()).toBe(true);
  expect(await page.locator('meta[name=apple-mobile-web-app-capable]').getAttribute('content')).toBe('yes');
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(sw).toContain('/myday-planner/sw.js');
});

test('settings: switch to Ukrainian, dark theme, export JSON backup, search', async ({ page }) => {
  await signUp(page);
  await addTask(page, 'Пошукова задача');
  await page.getByTestId('tab-more').click();
  await page.getByTestId('more-settings').click();
  await page.getByRole('tab', { name: 'Українська' }).first().click();
  await expect(page.locator('h1').first()).toHaveText('Налаштування');
  await page.getByRole('tab', { name: 'Темна' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const download = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const file = await download;
  const path = await file.path();
  const data = JSON.parse(readFileSync(path, 'utf8'));
  expect(data.app).toBe('myday-planner');
  expect(data.tasks.some((t: { title: string }) => t.title === 'Пошукова задача')).toBe(true);

  await page.getByTestId('tab-today').click();
  await page.getByRole('button', { name: 'Пошук' }).first().click();
  await page.getByTestId('search-input').fill('пошук');
  await expect(page.getByTestId('task-card').filter({ hasText: 'Пошукова задача' })).toBeVisible();
});
