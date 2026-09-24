"""
Ponto de Entrada do Servidor Tactical Dashboard (Piracicaba-SP)
Execute: python run.py
Acesse: http://localhost:8000
"""

import os
import sys

# Força codificação UTF-8 no terminal Windows para evitar UnicodeEncodeError
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print("=" * 60)
    print(">>> INICIANDO PIRA-TACTICAL HUB - PIRACICABA/SP")
    print(f">>> Servidor Web e API Ativos em: http://localhost:{port}")
    print(">>> Otimizado para suporte veicular mobile-first")
    print("=" * 60)
    uvicorn.run("backend.app:app", host="0.0.0.0", port=port, reload=True)
