#!/usr/bin/env bash
# Garde-fou : prouve que les regles type-aware d'oxlint s'appliquent vraiment.
#
# Sans lui, retirer `options.typeAware` de .oxlintrc.json ou la dependance
# oxlint-tsgolint ne casse rien de visible : le lint reste vert, il verifie
# simplement moins de choses. Un lint vert ne doit pas pouvoir mentir.
#
# Methode : un fichier cobaye avec une promesse jetee, que seule une regle
# ayant acces aux types peut detecter. Si l'avertissement ne remonte pas,
# les regles sont eteintes.
set -euo pipefail

cd "$(dirname "$0")/.."

CANARY=src/type-aware-canary.ts
# Le cobaye doit vivre dans src/ : c'est le seul dossier couvert par
# tsconfig.app.json, donc le seul ou l'information de type est disponible.
trap 'rm -f "$CANARY"' EXIT

cat > "$CANARY" <<'EOF'
// Genere par scripts/verify-type-aware.sh, supprime a la fin. Ne pas committer.
async function work(): Promise<void> {}
export function canary() {
  work()
}
EOF

# Le cobaye n'est volontairement PAS dans .gitignore : oxlint respecte
# .gitignore et refuserait de le lire (le drapeau --no-ignore ne couvre que
# .eslintignore). C'est le trap ci-dessus qui garantit qu'il ne survit pas.
if node_modules/.bin/oxlint "$CANARY" 2>&1 | grep -q "no-floating-promises"; then
  exit 0
fi

echo "Erreur : les regles type-aware d'oxlint ne s'appliquent pas." >&2
echo "  Attendu : no-floating-promises sur le fichier cobaye." >&2
echo "  A verifier : \"options\": { \"typeAware\": true } dans .oxlintrc.json," >&2
echo "  et la presence de la devDependency oxlint-tsgolint." >&2
exit 1
