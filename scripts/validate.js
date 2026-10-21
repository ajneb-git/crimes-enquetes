#!/usr/bin/env node
// Usage: node scripts/validate.js [--build]
// --build : génère dist/questions-verified.json avec seulement statut "verifie"

const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const DATA_DIR      = path.join(ROOT, 'data');
const QUESTIONS_DIR = path.join(DATA_DIR, 'questions');
const DIST_DIR      = path.join(ROOT, 'dist');

const BUILD = process.argv.includes('--build');

// ── Schema rules ──────────────────────────────────────────────────────────────

const VALID_MODULES            = ['qui_suis_je', 'duel', 'vrai_faux', 'chronologie', 'qcm'];
const VALID_STATUTS            = ['a_verifier', 'verifie'];
const VALID_STATUTS_JUDICIAIRES = ['condamnation_definitive', 'non_resolue', 'acquittement'];

const COMMON_FIELDS = ['id', 'affaire_id', 'module', 'explication', 'difficulte', 'pays', 'epoque', 'sources', 'statut', 'statut_judiciaire'];

const MODULE_FIELDS = {
  qcm:         ['question', 'propositions', 'bonne_reponse'],
  qui_suis_je: ['indices', 'propositions', 'bonne_reponse'],
  duel:        ['question', 'item_a', 'item_b', 'bonne_reponse'],
  vrai_faux:   ['affirmation', 'bonne_reponse'],
  chronologie: ['question', 'evenements'],
};

// ── Validators ────────────────────────────────────────────────────────────────

function validateQuestion(q, affaireMap) {
  const errors   = [];
  const warnings = [];

  // Common fields
  for (const f of COMMON_FIELDS) {
    if (q[f] === undefined || q[f] === null) {
      if (f !== 'explication') errors.push(`Champ manquant : ${f}`);
      else warnings.push(`Champ vide : explication`);
    }
  }

  if (q.module && !VALID_MODULES.includes(q.module)) {
    errors.push(`Module invalide : "${q.module}"`);
  }

  if (q.difficulte !== undefined && ![1, 2, 3].includes(q.difficulte)) {
    errors.push(`Difficulté invalide : ${q.difficulte} (doit être 1, 2 ou 3)`);
  }

  if (q.statut && !VALID_STATUTS.includes(q.statut)) {
    errors.push(`Statut invalide : "${q.statut}"`);
  }

  if (q.statut_judiciaire && !VALID_STATUTS_JUDICIAIRES.includes(q.statut_judiciaire)) {
    errors.push(`Statut judiciaire invalide : "${q.statut_judiciaire}"`);
  }

  if (!Array.isArray(q.sources) || q.sources.length < 2) {
    errors.push(`sources doit contenir au minimum 2 URLs (actuel : ${Array.isArray(q.sources) ? q.sources.length : 0})`);
  }

  // Module-specific fields
  const required = MODULE_FIELDS[q.module] || [];
  for (const f of required) {
    if (q[f] === undefined || q[f] === null) {
      errors.push(`Champ manquant pour le module "${q.module}" : ${f}`);
    }
  }

  // Propositions/bonne_reponse consistency
  if (q.module === 'qcm' || q.module === 'qui_suis_je') {
    if (Array.isArray(q.propositions) && q.bonne_reponse !== undefined) {
      if (!q.propositions.includes(q.bonne_reponse)) {
        errors.push(`bonne_reponse "${q.bonne_reponse}" absent des propositions`);
      }
      if (q.propositions.length !== 4) {
        warnings.push(`propositions contient ${q.propositions.length} éléments (attendu : 4)`);
      }
    }
  }

  if (q.module === 'duel') {
    if (q.bonne_reponse !== undefined && !['a', 'b'].includes(q.bonne_reponse)) {
      errors.push(`Duel : bonne_reponse doit être "a" ou "b" (reçu : "${q.bonne_reponse}")`);
    }
  }

  if (q.module === 'qui_suis_je') {
    if (Array.isArray(q.indices) && q.indices.length !== 4) {
      warnings.push(`QSJ : indices contient ${q.indices.length} éléments (recommandé : 4)`);
    }
  }

  if (q.module === 'chronologie') {
    if (Array.isArray(q.evenements)) {
      if (q.evenements.length !== 4) {
        errors.push(`Chronologie : evenements doit contenir 4 éléments (actuel : ${q.evenements.length})`);
      }
      for (const [i, ev] of q.evenements.entries()) {
        if (!ev.label || !ev.date_iso) {
          errors.push(`Chronologie : evenements[${i}] doit avoir label et date_iso`);
        } else if (isNaN(new Date(ev.date_iso).getTime())) {
          errors.push(`Chronologie : evenements[${i}].date_iso "${ev.date_iso}" non parseable`);
        }
      }
    }
  }

  // ── Règle éditoriale : statut_judiciaire != condamnation_definitive ──────────
  // Vérifie que la question elle-même ne désigne pas un coupable non définitif.
  // On contrôle uniquement la question/affirmation visible avant réponse (pas l'explication ni les propositions).
  // Les duels (bonne_reponse = "a"/"b") sont exclus car ces lettres apparaissent partout.
  if (q.statut_judiciaire && q.statut_judiciaire !== 'condamnation_definitive' && q.module !== 'duel') {
    const texteVisible = [
      q.question || '',
      q.affirmation || '',
      ...(q.indices || []),
    ].join(' ');

    const br = typeof q.bonne_reponse === 'string' ? q.bonne_reponse : '';
    if (br && br.length > 3 && texteVisible.toLowerCase().includes(br.toLowerCase())) {
      errors.push(
        `RÈGLE ÉDITORIALE — statut_judiciaire "${q.statut_judiciaire}" : ` +
        `bonne_reponse "${br}" apparaît dans la question visible (risque de désigner un coupable)`
      );
    }

    if (q.statut === 'verifie') {
      warnings.push(`Question verifie avec statut_judiciaire "${q.statut_judiciaire}" — relecture recommandée`);
    }
  }

  // affaire_id existe dans affaires.json
  if (q.affaire_id && affaireMap && !affaireMap[q.affaire_id]) {
    warnings.push(`affaire_id "${q.affaire_id}" non trouvé dans affaires.json`);
  }

  return { errors, warnings };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('── Validation Crimes & Enquêtes ──────────────────────────────\n');

  // Load affaires index
  let affaireMap = {};
  try {
    const affaires = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'affaires.json'), 'utf8'));
    affaireMap = Object.fromEntries(affaires.affaires.map(a => [a.id, a]));
    console.log(`✓ affaires.json chargé (${affaires.affaires.length} affaire(s))\n`);
  } catch (e) {
    console.error(`✗ Impossible de lire affaires.json : ${e.message}`);
    process.exit(1);
  }

  const files      = fs.readdirSync(QUESTIONS_DIR).filter(f => f.endsWith('.json'));
  const allVerified = [];
  let   totalQ      = 0;
  let   totalErrors = 0;

  for (const file of files) {
    const filePath = path.join(QUESTIONS_DIR, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`✗ ${file} : JSON invalide — ${e.message}`);
      totalErrors++;
      continue;
    }

    const questions = data.questions || [];
    const stats = { verifie: 0, a_verifier: 0, errors: 0, warnings: 0 };

    for (const q of questions) {
      totalQ++;
      const { errors, warnings } = validateQuestion(q, affaireMap);

      if (errors.length) {
        console.error(`  ✗ [${q.id || 'id?'}]`);
        errors.forEach(e => console.error(`      → ${e}`));
        stats.errors += errors.length;
        totalErrors  += errors.length;
      }
      if (warnings.length) {
        warnings.forEach(w => console.warn(`  ⚠ [${q.id || 'id?'}] ${w}`));
        stats.warnings += warnings.length;
      }

      if (q.statut === 'verifie') {
        stats.verifie++;
        allVerified.push(q);
      } else {
        stats.a_verifier++;
      }
    }

    const icon = stats.errors ? '✗' : '✓';
    console.log(`${icon} ${file} : ${questions.length} questions — ${stats.verifie} verifie, ${stats.a_verifier} a_verifier${stats.errors ? `, ${stats.errors} erreur(s)` : ''}${stats.warnings ? `, ${stats.warnings} alerte(s)` : ''}`);
  }

  console.log(`\n── Résumé ────────────────────────────────────────────────────`);
  console.log(`   Total questions    : ${totalQ}`);
  console.log(`   Prêtes (verifie)   : ${allVerified.length}`);
  console.log(`   À vérifier         : ${totalQ - allVerified.length}`);
  console.log(`   Erreurs de schéma  : ${totalErrors}`);

  if (BUILD) {
    if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
    const out = path.join(DIST_DIR, 'questions-verified.json');
    fs.writeFileSync(out, JSON.stringify({ questions: allVerified }, null, 2));
    console.log(`\n✓ Build : ${allVerified.length} questions écrites dans dist/questions-verified.json`);
  }

  if (totalErrors > 0) {
    console.error(`\n✗ Validation échouée (${totalErrors} erreur(s))`);
    process.exit(1);
  } else {
    console.log(`\n✓ Validation réussie`);
  }
}

main();
