#!/bin/bash
# Ponte do Estúdio → Photoshop
# Fica de olho na fila (Projetos/.fila); quando o app salva uma arte,
# abre o arquivo no Photoshop instalado (qualquer versão) ou no app padrão.

BASE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$BASE/Projetos"
FILA="$PROJ/.fila"
mkdir -p "$FILA"

# Garante uma única ponte rodando
LOCK="$FILA/.bridge.pid"
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ > "$LOCK"

abrir_no_photoshop() {
  local f="$1"
  open -b com.adobe.Photoshop "$f" 2>/dev/null && return
  open -a "Adobe Photoshop" "$f" 2>/dev/null && return
  local app
  app="$(ls -d "/Applications/Adobe Photoshop"*/"Adobe Photoshop"*.app 2>/dev/null | sort | tail -1)"
  if [ -n "$app" ]; then
    open -a "$app" "$f" 2>/dev/null && return
  fi
  open "$f" # sem Photoshop: abre no app de imagem padrão
}

while true; do
  # vigia QUALQUER pasta .fila dentro do app — funciona com qualquer
  # pasta que o usuário tenha conectado no Chrome (Projetos, fotos p ditar…)
  find "$BASE" -maxdepth 4 -type f -path '*/.fila/*.txt' -print0 2>/dev/null |
  while IFS= read -r -d '' t; do
    rel="$(cat "$t")"
    rm -f "$t"
    root="$(dirname "$(dirname "$t")")"
    f="$root/$rel"
    [ -f "$f" ] && abrir_no_photoshop "$f"
  done
  sleep 2
done
