/* Konfiguracja ze zmiennych środowiskowych (.env). */
export const CFG = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  appOrigin: (process.env.APP_ORIGIN || 'http://localhost:8787').replace(/\/$/, ''),
  emailMode: process.env.EMAIL_MODE || 'console',
  resendKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'CodeMap <no-reply@localhost>',
  defaultQuota: Number(process.env.DEFAULT_QUOTA_BYTES || 2 * 1024 * 1024 * 1024),
  maxUpload: Number(process.env.MAX_UPLOAD_BYTES || 220_000_000),
  // publiczne linki do map: rozmiar jednej mapy (= limit klienta dla Gista / linku) i liczba aktywnych linków na konto
  maxShare: Number(process.env.MAX_SHARE_BYTES || 25 * 1024 * 1024),
  maxSharesPerUser: Number(process.env.MAX_SHARES_PER_USER || 100),
  prod: process.env.NODE_ENV === 'production',
};
