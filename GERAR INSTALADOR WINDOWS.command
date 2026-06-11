#!/bin/bash
# Livrai — gera um instalador Windows novo com as ferramentas atuais.
# Dois cliques e pronto: o resultado aparece na pasta INSTALADORES.
cd "$(dirname "$0")"
BASE="$PWD"

falhou() {
  echo
  echo "❌ Algo deu errado acima. Tire um print desta janela e me mostre."
  read -r -p "Aperte Enter para fechar..." _
  exit 1
}
trap falhou ERR
set -e

echo "═══════════════════════════════════════════"
echo "  LIVRAI — GERAR INSTALADOR WINDOWS"
echo "═══════════════════════════════════════════"
echo

echo "1/4  Copiando as ferramentas atuais para dentro do app..."
cd "$BASE/desktop"
rm -rf app && mkdir app
cp -R "$BASE/index.html" "$BASE/LEIA-ME.txt" "$BASE/css" "$BASE/js" app/

echo "2/4  Subindo o número da versão..."
npm version patch --no-git-tag-version > /dev/null
V=$(node -p "require('./package.json').version")
echo "     → versão $V"

echo "3/4  Empacotando (demora 1 a 3 minutos, aguarde)..."
npm run dist:win

echo "4/4  Levando para a pasta INSTALADORES..."
mkdir -p "$BASE/INSTALADORES"
rm -f "$BASE/INSTALADORES"/Instalar-Livrai-*.exe
rm -f "$BASE/INSTALADORES"/Livrai-*-portatil.zip
cp "dist-installers/Instalar-Livrai-$V-Windows.exe" "$BASE/INSTALADORES/"
rm -rf /tmp/Livrai
cp -R dist-installers/win-unpacked /tmp/Livrai
ditto -c -k --keepParent /tmp/Livrai "$BASE/INSTALADORES/Livrai-$V-Windows-portatil.zip"
rm -rf /tmp/Livrai

echo
echo "═══════════════════════════════════════════"
echo "  ✅ Pronto! Versão $V está em INSTALADORES/"
echo
echo "  Mande o Instalar-Livrai-$V-Windows.exe pro"
echo "  computador Windows e instale por cima da"
echo "  versão antiga — os projetos continuam lá."
echo "═══════════════════════════════════════════"
trap - ERR
read -r -p "Aperte Enter para fechar..." _ || true
