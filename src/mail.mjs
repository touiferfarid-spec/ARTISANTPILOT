import {config} from './config.mjs';
import {htmlEscape as escape} from './site-builder.mjs';
import {AppError} from './errors.mjs';

export const mailConfigured = () => Boolean(config.mailKey && config.mailFrom);
export async function sendAccountMail(email, kind, value) {
  if (!mailConfigured()) throw new AppError('L’envoi d’emails n’est pas encore configuré. Vous pouvez utiliser la connexion Google.', 503);
  const reset = kind === 'reset';
  // Fragments keep one-use credentials out of HTTP logs and Referer headers.
  const link = `${config.baseUrl}/account#${reset ? 'reset' : 'verify'}=${encodeURIComponent(value)}`;
  const title = reset ? 'Choisissez un nouveau mot de passe' : 'Confirmez votre adresse email';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.mailKey}`},
    body: JSON.stringify({from: config.mailFrom, to: [email], subject: `${title} — ArtisanPilot`,
      html: `<h1>${title}</h1><p><a href="${escape(link)}">${title}</a></p><p>Ce lien est personnel, utilisable une seule fois et expire dans ${reset ? '30 minutes' : '24 heures'}. Si vous n’avez pas fait cette demande, ignorez cet email.</p>`}),
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) throw new AppError('L’email n’a pas pu être envoyé. Réessayez plus tard.', 503);
}
