// Строки пишутся по-русски прямо в коде; для английского интерфейса — словарь EN.
import { fmt } from './util.js';
import { EN } from './i18n-en.js';

export function t(key, ...args) {
  let s = fmt.lang === 'en' ? (EN[key] ?? key) : key;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
  return s;
}
