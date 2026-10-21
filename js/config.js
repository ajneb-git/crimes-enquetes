// true = toutes les questions (y compris a_verifier) sont jouables
// false = uniquement statut "verifie" (production)
export const DEV_MODE = true;

export const POINTS = { 1: 1, 2: 2, 3: 3 };

export const MODULE_LABELS = {
  qui_suis_je: 'Qui suis-je ?',
  duel:        'Duel',
  vrai_faux:   'Vrai / Faux',
  chronologie: 'Chronologie',
  qcm:         'QCM',
};

export const PERF_LABELS = [
  { min: 0.9,  label: '🏆 Excellent !' },
  { min: 0.7,  label: '🎯 Très bien !' },
  { min: 0.5,  label: '👍 Pas mal !' },
  { min: 0.3,  label: '📚 À retravailler' },
  { min: 0,    label: '💡 Continue tes efforts !' },
];
