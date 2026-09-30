#!/usr/bin/env python3
"""Cadastra os profissionais de profissionais-iniciais.json no hub. Rode uma vez (não confere duplicados).
Uso: python3 scripts/importar_profissionais.py [http://192.168.0.10]"""
import json, os, sys, urllib.request

hub = (sys.argv[1] if len(sys.argv) > 1 else "http://192.168.0.10").rstrip("/")
arq = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profissionais-iniciais.json")
with open(arq, encoding="utf-8") as f:
    for p in json.load(f):
        req = urllib.request.Request(hub + "/api/contatos", json.dumps(p).encode("utf-8"), {"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req).read()
            print("ok:", p["nome"])
        except Exception as e:
            print("FALHOU:", p["nome"], e)
