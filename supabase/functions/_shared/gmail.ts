// Gmail SMTP sending shared by send-protocol-mail and send-reminders.
import nodemailer from 'npm:nodemailer@6.9.16';

function creds() {
  // Google shows app passwords in groups of four ("abcd efgh …"); spaces are not part of it
  return {
    user: (Deno.env.get('GMAIL_USER') || '').trim(),
    pass: (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s+/g, ''),
  };
}

export function gmailConfigured(): boolean {
  const { user, pass } = creds();
  return !!user && !!pass;
}

export type MailAttachment = { filename: string; content: string; encoding: 'base64'; contentType: string };

// Throws on failure; `e.code === 'EAUTH'` means wrong credentials (setup problem)
export async function sendGmail(msg: { to: string; subject: string; text: string; html: string; attachments?: MailAttachment[] }) {
  const { user, pass } = creds();
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
  try {
    await transport.sendMail({ from: `"Lübbert App" <${user}>`, ...msg, attachments: msg.attachments || [] });
  } catch (e) {
    // Shape only (never the values) to debug credential setup
    if ((e as { code?: string })?.code === 'EAUTH') {
      console.error(`gmail: credential shape user_has_at=${user.includes('@')} user_domain=${user.split('@')[1] || '-'} pass_len=${pass.length} pass_letters_only=${/^[a-z]+$/i.test(pass)}`);
    }
    throw e;
  }
}
