#!/bin/bash
# Abre o Estúdio no navegador e liga as pontes (Photoshop + OpenAI)
BASE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$BASE/Projetos"
nohup /bin/bash "$BASE/photoshop-bridge.sh" >/dev/null 2>&1 &
nohup /usr/bin/env python3 "$BASE/proxy.py" >/dev/null 2>&1 &
open "$BASE/index.html"
