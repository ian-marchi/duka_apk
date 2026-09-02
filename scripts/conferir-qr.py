"""
Confere o gerador de QR da pagina — decodificando o que ele produz.

Um QR errado nao avisa: ele so nao escaneia, e voce descobre pelo aluno que
desistiu. Como o gerador foi escrito a mao (a pagina nao carrega script de
fora), ele precisa de prova.

A prova aqui e de ponta a ponta: gera a matriz, desenha a imagem e manda um
leitor de verdade (o detector do OpenCV) ler de volta. Se o texto que sai e
igual ao que entrou, o QR presta — que e a unica coisa que importa.

Comparar matriz com outra biblioteca foi o primeiro caminho e se mostrou pior:
o segno enche o final com um byte a mais de zeros antes dos codewords de
enchimento, e escolhe modo alfanumerico quando da. Sao escolhas legitimas e
diferentes das minhas, que fazem a matriz divergir sem que nada esteja errado.
Decodificar nao tem essa ambiguidade.

    pip install opencv-python-headless numpy
    python scripts/conferir-qr.py
"""

import json
import re
import subprocess
import sys
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:
    sys.exit("faltam dependencias: pip install opencv-python-headless numpy")

AQUI = Path(__file__).resolve().parent
QR_JS = AQUI.parent / "public" / "qr.js"

ESCALA = 8      # pixels por modulo
MARGEM = 4      # zona silenciosa exigida pela norma

CASOS = [
    "https://dukatesters-production.up.railway.app/",
    "https://dukatesters-production.up.railway.app",
    "https://testflight.apple.com/join/ru3sSPJT",
    "A",
    "acentuação e cedilha: ção",       # multibyte em UTF-8
    "x" * 14,                           # teto da versao 1-M
    "x" * 15,                           # forca a versao 2
    "x" * 26,                           # teto da versao 2-M
    "x" * 42,                           # teto da versao 3-M
    "x" * 62,                           # teto da versao 4-M
    "x" * 84,                           # teto da versao 5-M
    "x" * 106,                          # teto da versao 6-M
]


def gerar(texto):
    """Roda o gerador da pagina no Node e devolve {modulos, versao, svg}.

    Avaliado em vez de importado: o package.json declara "type": "module",
    entao require() deste arquivo devolveria um modulo ESM vazio. O qr.js e um
    script de navegador — ele so pendura DukaQR no objeto global.
    """
    script = (
        "eval(require('fs').readFileSync(%s,'utf8'));"
        "const t=JSON.parse(process.argv[1]);"
        "const r=globalThis.DukaQR.gerar(t);"
        "if(r) r.svg=globalThis.DukaQR.svg(t);"
        "process.stdout.write(JSON.stringify(r));"
    ) % json.dumps(str(QR_JS))
    saida = subprocess.run(
        ["node", "-e", script, json.dumps(texto)], capture_output=True, text=True
    )
    if saida.returncode != 0:
        raise RuntimeError(saida.stderr.strip())
    return json.loads(saida.stdout)


def matriz_do_svg(svg):
    """
    Le de volta a matriz a partir do path do SVG.

    A matriz estar certa nao garante que o desenho esteja: e no `svg()` que os
    modulos viram coordenadas, e e o desenho que a camera enxerga. Esta leitura
    fecha esse vao — inclusive a zona silenciosa, que ja vem embutida no
    viewBox.
    """
    lado = int(re.search(r'viewBox="0 0 (\d+) ', svg).group(1))
    grade = [[0] * lado for _ in range(lado)]
    for x, y in re.findall(r"M(\d+) (\d+)h1v1h-1z", svg):
        grade[int(y)][int(x)] = 1
    return grade


def imagem(modulos, margem=MARGEM):
    """Matriz -> imagem em tons de cinza, com a zona silenciosa."""
    n = len(modulos)
    lado = n + margem * 2
    grade = np.ones((lado, lado), dtype=np.uint8) * 255
    for y in range(n):
        for x in range(n):
            if modulos[y][x]:
                grade[y + margem, x + margem] = 0
    return np.kron(grade, np.ones((ESCALA, ESCALA), dtype=np.uint8))


def main():
    leitor = cv2.QRCodeDetector()
    falhas = 0

    for texto in CASOS:
        rotulo = texto if len(texto) <= 46 else f"{len(texto)} caracteres"
        qr = gerar(texto)

        if qr is None:
            print(f"  NAO COUBE   {rotulo}")
            falhas += 1
            continue

        n = len(qr["modulos"])

        # 1) a matriz, e 2) o SVG que a pagina realmente desenha. O SVG ja
        #    traz a zona silenciosa no viewBox, entao vai sem margem extra.
        provas = [
            ("matriz", imagem(qr["modulos"])),
            ("svg", imagem(matriz_do_svg(qr["svg"]), margem=0)),
        ]

        for nome, img in provas:
            lido, _, _ = leitor.detectAndDecode(img)
            if lido == texto:
                continue
            print(f"  {'NAO LEU' if not lido else 'TEXTO ERRADO'}  [{nome}]  {rotulo}"
                  + (f": leu {lido!r}" if lido else ""))
            falhas += 1
            break
        else:
            print(f'  ok          v{qr["versao"]}  {n}x{n}  {rotulo}')

    print()
    print("tudo conferido" if not falhas else f"{falhas} caso(s) com problema")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
