// French phone numbers for advertiser-owned Google Ads call assets.
// Only the number provided by the verified ArtisanPilot account is used.
export function normalizeFrenchPhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (raw.length > 40 || !/^[+\d\s().-]+$/.test(raw)) throw new Error('Numéro de téléphone français invalide.');
  const compact = raw.replace(/[\s().-]/g, '');
  if (/^0[1-9]\d{8}$/.test(compact)) return '+33' + compact.slice(1);
  if (/^\+33[1-9]\d{8}$/.test(compact)) return compact;
  if (/^0033[1-9]\d{8}$/.test(compact)) return '+' + compact.slice(2);
  throw new Error('Utilisez un numéro français à 10 chiffres, par exemple 01 23 45 67 89.');
}
