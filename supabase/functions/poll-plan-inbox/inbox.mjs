// Pure helpers for poll-plan-inbox (node --test): which mails count as a Wochenplan from Daniel.
import { createHash } from 'node:crypto';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// "a@x.de, B@y.de" → ['a@x.de', 'b@y.de']; empty/unset → [] (the function then refuses to read anything)
export function parseAllowed(s) {
  return String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

// Gmail stamps Authentication-Results; a forged From without DKIM/DMARC pass is not trusted
export function authPassed(header) {
  const h = String(header || '');
  return /\bdmarc=pass\b/i.test(h) || /\bdkim=pass\b/i.test(h);
}

// An entry is a full address or a whole domain ("@firma.de")
export function senderAllowed(addr, allowed) {
  const a = String(addr || '').toLowerCase();
  return !!a && allowed.some((x) => (x.startsWith('@') ? a.endsWith(x) : a === x));
}

const isPdf = (a) => /pdf/i.test(a.contentType || '') || /\.pdf$/i.test(a.filename || '');

// mail: mailparser result ({ from.value[].address, headers (Map), attachments[{ filename, contentType, size }] }).
// Returns the PDF attachments to store, or [] when sender/auth don't match.
export function pickPlanPdfs(mail, allowed) {
  const from = String(mail?.from?.value?.[0]?.address || '').toLowerCase();
  if (!senderAllowed(from, allowed)) return [];
  const auth = mail.headers?.get ? mail.headers.get('authentication-results') : '';
  if (!authPassed(Array.isArray(auth) ? auth.join(' ') : auth)) return [];
  return (mail.attachments || []).filter((a) => isPdf(a) && a.size > 0 && a.size <= MAX_PDF_BYTES);
}

// One unique, path-safe object name per message + attachment
export function storagePath(messageId, index, fileName) {
  const h = createHash('sha256').update(String(messageId)).digest('hex').slice(0, 16);
  const safe = String(fileName || 'plan.pdf').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'plan.pdf';
  return `${h}-${index}-${safe}`;
}
