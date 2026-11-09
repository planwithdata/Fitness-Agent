import { calendarDate } from './import-model.js';

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const orderLabel = /\b(?:order\s*(?:id|no\.?|number|#)|order\s*reference)\s*[:#–-]*\s*([A-Z0-9][A-Z0-9/_-]{4,49})\b/i;
const currency = '(?:(?:₹|Rs\\.?|INR)\\s*)?';
const decimal = '(\\d+(?:,\\d+)*(?:\\.\\d{1,2})?)';
const totalPatterns = [
  /^(?:net\s+)?(?:amount\s+paid|total\s+(?:amount\s+)?paid|paid\s+amount|you\s+paid)\b/i,
  /^(?:grand\s+total|order\s+total|total\s+order\s+(?:value|amount)|total\s+(?:bill\s+amount|payable)|amount\s+payable|net\s+payable|bill\s+total|final\s+total)\b/i,
  /^(?:(?:net|invoice)\s+total|total\s+(?:invoice\s+)?(?:amount|value)|total\s+invoice|total)\b/i,
];

function dateKey(year, month, day) {
  return calendarDate([year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-'));
}

function receiptDate(line) {
  let match = line.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (match) return dateKey(match[1], match[2], match[3]);
  match = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (match) return dateKey(match[3], match[2], match[1]);
  match = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,-]+(20\d{2})\b/i);
  if (match) return dateKey(match[3], months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, match[1]);
  match = line.match(/\b([A-Za-z]{3,9})[\s-]+(\d{1,2})(?:st|nd|rd|th)?[\s,-]+(20\d{2})\b/i);
  return match ? dateKey(match[3], months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, match[2]) : '';
}

function detectedDate(lines) {
  for (const pattern of [/\border\s*(?:date|time|placed\s+on)\b/i, /\b(?:invoice\s*date|date\s+of\s+invoice|issued\s+on|date)\b/i]) {
    for (const [index, line] of lines.entries()) {
      if (!pattern.test(line)) continue;
      const date = receiptDate(line) || (/^(?:\d|[A-Z]{3,9}\s\d)/i.test(lines[index + 1] ?? '') ? receiptDate(lines[index + 1]) : '');
      if (date) return date;
    }
  }
  return '';
}

function detectedTotal(lines) {
  for (const [priority, pattern] of totalPatterns.entries()) {
    const amounts = new Set();
    for (const [index, line] of lines.entries()) {
      const match = line.match(pattern);
      if (!match) continue;
      const rest = line.slice(match[0].length).trim().replace(/^[:–-]\s*/, '');
      const number = new RegExp('^' + currency + decimal + '(?:\\s*(?:INR|only))?$', 'i').exec(rest || lines[index + 1] || '');
      if (!number) continue;
      const paise = Math.round(Number(number[1].replaceAll(',', '')) * 100);
      if (Number.isSafeInteger(paise) && paise > 0 && paise <= 1e9) amounts.add(paise);
    }
    if (amounts.size === 1) return { amount: [...amounts][0], weakTotal: priority === 2 };
    if (amounts.size > 1) return { amount: null, weakTotal: true };
  }
  return { amount: null, weakTotal: false };
}

function detectedItems(lines) {
  const result = new Map();
  let inItems = false;
  for (const line of lines) {
    if (/\b(?:item\s+description|description\s+of\s+goods|product\s+(?:name|description)|particulars\s+.*(?:qty|quantity)|description.*(?:hsn|qty)|ordered\s+items|your\s+order)\b/i.test(line)) {
      inItems = true;
      continue;
    }
    if (/^(?:(?:item|sub|grand|order|invoice|net)\s*total|subtotal|amount\s+paid|total\s+(?:amount|qty)|total\s*:|tax\s+summary|delivery\s+(?:fee|charges)|payment\s+details)\b/i.test(line)) inItems = false;
    if (/^(?:GSTIN|FSSAI|PAN|order|invoice|address|phone|email|seller|merchant|restaurant|tax|GST|CGST|SGST|IGST|discount|delivery|packaging|platform|payment|total|round\s*off|bill\s+to|ship\s+to)\b/i.test(line)) continue;
    let name;
    let quantity = null;
    let match = line.match(/^(\d{1,3})\s*[x×]\s+(.+)$/i);
    if (match) {
      quantity = Number(match[1]);
      name = match[2].replace(/\s+(?:₹|Rs\.?|INR)\s*[\d,.]+.*$/i, '');
    } else if (inItems) {
      match = line.match(/^(?:\d{1,3}[.)]?\s+)?(.+?)\s+(\d{4,8})\s+(\d{1,3})(?:\.00)?(?:\s|$)/);
      if (!match) match = line.match(/^(?:\d{1,3}[.)]?\s+)?(.+?)\s+(\d{1,3})(?:\.00)?\s+(?:₹|Rs\.?|INR)\s*[\d,.]+/i);
      if (match) {
        name = match[1];
        quantity = Number(match[match.length - 1]);
      }
    }
    if (!name || !/[\p{L}]{2}/u.test(name) || /@|\b\d{10}\b/.test(name)) continue;
    name = name.trim().slice(0, 100);
    const key = name.toLowerCase();
    if (!result.has(key) && result.size < 100) result.set(key, { name, quantity: quantity > 0 ? quantity : null });
  }
  return [...result.values()];
}

export function parseReceipt(text) {
  const lines = text.slice(0, 350_000).normalize('NFKC').split(/\r?\n/)
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean);
  const header = lines.slice(0, 32).join(' ');
  const provider = /\b(?:blinkit|blink commerce|grofers)\b/i.test(header) ? 'blinkit'
    : /\b(?:zomato|eternal limited)\b/i.test(header) ? 'zomato' : '';
  const merchant = lines.map(line => /^\s*(?:restaurant(?:\s+name)?|merchant(?:\s+name)?|seller\s+name)\s*[:–-]\s*(.+)$/i.exec(line)?.[1])
    .find(name => name && name.length <= 100) ?? '';
  const orderId = lines.map(line => line.match(orderLabel)?.[1]).find(id => id && /\d/.test(id)) ?? '';
  return { provider, merchant, orderId, date: detectedDate(lines), ...detectedTotal(lines), items: detectedItems(lines) };
}
