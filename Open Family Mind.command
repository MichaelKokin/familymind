#!/bin/bash
set -u
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
  fi
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Не найден Node.js. Откройте Терминал с Node.js 20.19+ и выполните npm run case:launch из папки FamilyMind.'
  read -r -p 'Нажмите Enter, чтобы закрыть окно. ' _familymind_reply
  exit 1
fi
npm run case:launch
_familymind_status=$?
if [ "$_familymind_status" -ne 0 ]; then
  read -r -p 'Нажмите Enter, чтобы закрыть окно. ' _familymind_reply
fi
exit "$_familymind_status"
