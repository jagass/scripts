@echo off
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py) || (set PY=python)
%PY% -c "import requests, openpyxl" 2>nul || (
  echo Instalez pachetele necesare...
  %PY% -m pip install --user requests openpyxl
)
start "" %PY%w flashscore_gui.py 2>nul || %PY% flashscore_gui.py
