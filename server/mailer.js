/* Wysyłka e-maili: 'console' (dev — link na stdout) lub 'resend' (HTTPS API). */
import { CFG } from './config.js';

const T = {
  pl: {
    verifySubject: 'Potwierdź swoje konto CodeMap',
    verifyBody: (link) => `Cześć!\n\nAby dokończyć rejestrację w CodeMap, kliknij poniższy link (ważny 24 godziny):\n\n${link}\n\nJeśli to nie Ty zakładałeś(-aś) konto, zignoruj tę wiadomość.`,
    resetSubject: 'Reset hasła CodeMap',
    resetBody: (link) => `Cześć!\n\nOtrzymaliśmy prośbę o reset hasła. Kliknij poniższy link (ważny 30 minut):\n\n${link}\n\nJeśli to nie Ty, zignoruj tę wiadomość — hasło pozostanie bez zmian.`,
    existsSubject: 'Próba rejestracji w CodeMap',
    existsBody: () => `Ktoś próbował założyć konto CodeMap na ten adres, ale konto już istnieje.\n\nJeśli to Ty — zaloguj się lub użyj opcji resetu hasła.\nJeśli nie — możesz zignorować tę wiadomość.`,
  },
  en: {
    verifySubject: 'Confirm your CodeMap account',
    verifyBody: (link) => `Hi!\n\nTo finish signing up for CodeMap, click the link below (valid for 24 hours):\n\n${link}\n\nIf you did not create this account, ignore this message.`,
    resetSubject: 'CodeMap password reset',
    resetBody: (link) => `Hi!\n\nWe received a password reset request. Click the link below (valid for 30 minutes):\n\n${link}\n\nIf this wasn't you, ignore this message — your password stays unchanged.`,
    existsSubject: 'CodeMap sign-up attempt',
    existsBody: () => `Someone tried to create a CodeMap account with this address, but the account already exists.\n\nIf it was you — log in or use the password reset option.\nOtherwise you can ignore this message.`,
  },
};

async function deliver(to, subject, text) {
  if (CFG.emailMode === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CFG.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: CFG.emailFrom, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    return;
  }
  console.log(`[MAIL] to=${to} subject="${subject}"\n${text}\n[/MAIL]`);
}

export const sendVerifyMail = (to, lang, token) =>
  deliver(to, T[lang].verifySubject, T[lang].verifyBody(`${CFG.appOrigin}/api/auth/verify?token=${token}`));

export const sendResetMail = (to, lang, token) =>
  deliver(to, T[lang].resetSubject, T[lang].resetBody(`${CFG.appOrigin}/?reset=${token}`));

export const sendExistsMail = (to, lang) =>
  deliver(to, T[lang].existsSubject, T[lang].existsBody());
