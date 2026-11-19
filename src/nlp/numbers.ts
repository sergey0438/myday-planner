// Converts Russian / Ukrainian number words into digits.
// Cardinals become plain digits ("девять" -> "9"), ordinals get the suffix "ord"
// ("десятого" -> "10ord", "дев'ятій" -> "9ord").

const CARDINAL_UNITS: Record<string, number> = {
  // ru
  'ноль': 0, 'нуль': 0, 'один': 1, 'одна': 1, 'одну': 1, 'одно': 1, 'два': 2, 'две': 2, 'три': 3,
  'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9,
  // uk
  // genitive ("с девяти до одиннадцати")
  'одного': 1, 'двух': 2, 'трех': 3, 'четырех': 4, 'пяти': 5, 'шести': 6, 'семи': 7, 'восьми': 8, 'девяти': 9,
  'двох': 2, 'трьох': 3, 'чотирьох': 4, "п'яти": 5, "дев'яти": 9,
  'одне': 1, 'дві': 2, 'чотири': 4, "п'ять": 5, 'шість': 6, 'сім': 7, 'вісім': 8, "дев'ять": 9,
};

const CARDINAL_TEENS: Record<string, number> = {
  'десять': 10, 'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13, 'четырнадцать': 14,
  'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18, 'девятнадцать': 19,
  'одинадцять': 11, 'дванадцять': 12, 'тринадцять': 13, 'чотирнадцять': 14, "п'ятнадцять": 15,
  'шістнадцять': 16, 'сімнадцять': 17, 'вісімнадцять': 18, "дев'ятнадцять": 19,
  'десяти': 10, 'одиннадцати': 11, 'двенадцати': 12, 'тринадцати': 13, 'четырнадцати': 14, 'пятнадцати': 15,
  'шестнадцати': 16, 'семнадцати': 17, 'восемнадцати': 18, 'девятнадцати': 19,
  'одинадцяти': 11, 'дванадцяти': 12, 'тринадцяти': 13, 'чотирнадцяти': 14, "п'ятнадцяти": 15,
  'шістнадцяти': 16, 'сімнадцяти': 17, 'вісімнадцяти': 18, "дев'ятнадцяти": 19,
};

const CARDINAL_TENS: Record<string, number> = {
  'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50,
  'двадцять': 20, 'тридцять': 30, "п'ятдесят": 50,
  'двадцати': 20, 'тридцати': 30, 'двадцяти': 20, 'тридцяти': 30, 'сорока': 40,
};

// Ordinal stems -> value. Matched with an inflection ending.
const ORD_STEMS: [string, number][] = [
  // ru
  ['перв', 1], ['втор', 2], ['трет', 3], ['четверт', 4], ['пят', 5], ['шест', 6], ['седьм', 7],
  ['восьм', 8], ['девят', 9], ['десят', 10], ['одиннадцат', 11], ['двенадцат', 12], ['тринадцат', 13],
  ['четырнадцат', 14], ['пятнадцат', 15], ['шестнадцат', 16], ['семнадцат', 17], ['восемнадцат', 18],
  ['девятнадцат', 19], ['двадцат', 20], ['тридцат', 30],
  // uk
  ['перш', 1], ['друг', 2], ["п'ят", 5], ['шост', 6], ['сьом', 7], ["дев'ят", 9],
  ['одинадцят', 11], ['дванадцят', 12], ['тринадцят', 13], ['чотирнадцят', 14], ["п'ятнадцят", 15],
  ['шістнадцят', 16], ['сімнадцят', 17], ['вісімнадцят', 18], ["дев'ятнадцят", 19], ['двадцят', 20], ['тридцят', 30],
];
const ORD_ENDINGS = ['ого', 'ое', 'ый', 'ий', 'ій', 'ой', 'ом', 'ая', 'ую', 'ей', 'ьего', 'ье', 'ья', 'ью', 'ьей',
  'е', 'ої', 'у', 'а', 'ю', 'ього', 'ьої', 'ім', 'ому', 'ьому', 'ему', 'им'];

function ordinalValue(word: string, uk: boolean): number | null {
  for (const [stem, n] of ORD_STEMS) {
    if (!word.startsWith(stem)) continue;
    const end = word.slice(stem.length);
    if (!ORD_ENDINGS.includes(end)) continue;
    // "друг*" is "another" in Russian; only treat as ordinal for Ukrainian text.
    if (stem === 'друг' && !uk) continue;
    // "пята" / "пяту" etc. are body parts / rare; require typical endings for "пят"
    if ((stem === 'пят' || stem === "п'ят") && !['ого', 'ое', 'ый', 'ий', 'ій', 'ой', 'ом', 'ую', 'ая', 'е', 'ої', 'у', 'а', 'ому', 'им', 'ім'].includes(end)) continue;
    // "шест" + "ом" (with a pole) / "перв" + "ое" (first) are fine. Avoid "третье" ambiguity: fine.
    return n;
  }
  return null;
}

export function isUkrainian(text: string): boolean {
  return /[іїєґІЇЄҐ]/.test(text);
}

/** Converts number words inside a list of tokens. */
export function convertNumberTokens(tokens: string[], uk: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const w = raw.toLowerCase();
    const next = (tokens[i + 1] ?? '').toLowerCase();
    if (w in CARDINAL_TENS) {
      const tens = CARDINAL_TENS[w];
      if (next in CARDINAL_UNITS && CARDINAL_UNITS[next] > 0) {
        out.push(String(tens + CARDINAL_UNITS[next]));
        i++;
        continue;
      }
      const ord = ordinalValue(next, uk);
      if (ord !== null && ord < 10) {
        out.push(`${tens + ord}ord`);
        i++;
        continue;
      }
      out.push(String(tens));
      continue;
    }
    if (w in CARDINAL_TEENS) { out.push(String(CARDINAL_TEENS[w])); continue; }
    if (w in CARDINAL_UNITS) { out.push(String(CARDINAL_UNITS[w])); continue; }
    const ord = ordinalValue(w, uk);
    if (ord !== null) { out.push(`${ord}ord`); continue; }
    // "9-го", "25-е", "10-й" -> ordinal
    const m = /^(\d{1,2})-?(го|е|й|ое|ого|ий|ій|ю|у|ої|ом)$/i.exec(raw);
    if (m) { out.push(`${m[1]}ord`); continue; }
    out.push(raw);
  }
  return out;
}
