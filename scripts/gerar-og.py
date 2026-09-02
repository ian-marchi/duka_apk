"""
Gera a imagem de previa de compartilhamento (Open Graph), em public/og.png.

Por que um script e nao um PNG solto no repositorio: quando a marca mudar, a
imagem se refaz com um comando em vez de depender de alguem lembrar como ela
foi feita. As fontes e o wordmark saem das fontes de verdade do projeto, nao de
uma copia.

    python scripts/gerar-og.py

1200x630 e a proporcao que WhatsApp, Telegram, iMessage, X e LinkedIn esperam.
Fora dela o recorte fica por conta de cada um.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = Path(__file__).resolve().parent
PROJETO = AQUI.parent
PATH_APP = Path(r"G:\ian\prog\Path_app")

SAIDA = PROJETO / "public" / "og.png"
ICONE = PROJETO / "public" / "icon.png"
WORDMARK = PATH_APP / "icons" / "duka-wordmark-limpo.png"
FONTES = PATH_APP / "apps" / "mobile" / "node_modules" / "@expo-google-fonts"

# Mesmos tokens do index.html (colors.ts, preset roxo:vibrante)
FUNDO = (13, 10, 20)
PRIMARIA = (172, 83, 213)
PRIMARIA_CLARA = (199, 122, 224)
SECUNDARIA = (102, 45, 145)
PROFUNDA = (67, 0, 85)
TEXTO = (240, 232, 250)
TEXTO_2 = (184, 165, 212)

L, A = 1200, 630


def brilho(centro, raio, cor, forca):
    """
    Borrao radial da cor da marca, equivalente aos radial-gradient do CSS.

    Calculado numa grade minuscula e ampliado com BICUBIC: o custo cai de 756
    mil pixels pra 12 mil, e a ampliacao suaviza tudo. Desenhar direto no
    tamanho final deixava emendas retangulares visiveis onde o quadrado do
    gradiente era cortado pela borda da tela.
    """
    pl, pa = 120, 63
    pequeno = Image.new("L", (pl, pa), 0)
    px = pequeno.load()
    cx, cy = centro[0] * pl / L, centro[1] * pa / A
    rx, ry = raio * pl / L, raio * pa / A

    for y in range(pa):
        for x in range(pl):
            d = (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) ** 0.5
            if d < 1:
                # queda suave (cosseno elevado) — sem aresta em lugar nenhum
                px[x, y] = int(255 * forca * (1 - d) ** 2)

    mascara = pequeno.resize((L, A), Image.BICUBIC)
    camada = Image.new("RGBA", (L, A), cor + (0,))
    camada.putalpha(mascara)
    return camada


def cantos_arredondados(img, raio):
    mascara = Image.new("L", img.size, 0)
    ImageDraw.Draw(mascara).rounded_rectangle(
        [0, 0, img.size[0] - 1, img.size[1] - 1], radius=raio, fill=255
    )
    saida = img.convert("RGBA")
    saida.putalpha(mascara)
    return saida


def pintar(img, cor):
    """Repinta preservando o alpha — o wordmark e escuro e o fundo aqui tambem."""
    solido = Image.new("RGBA", img.size, cor + (255,))
    solido.putalpha(img.getchannel("A"))
    return solido


def fonte(caminho, tamanho):
    return ImageFont.truetype(str(FONTES / caminho), tamanho)


def main():
    tela = Image.new("RGBA", (L, A), FUNDO + (255,))

    for centro, raio, cor, forca in [
        ((600, -60), 900, PRIMARIA, 0.30),
        ((1210, 690), 700, SECUNDARIA, 0.38),
        ((10, 640), 620, PROFUNDA, 0.50),
    ]:
        tela.alpha_composite(brilho(centro, raio, cor, forca))

    # ── Icone do app, com os cantos do iOS ────────────────────────────────
    icone = cantos_arredondados(
        Image.open(ICONE).convert("RGB").resize((300, 300), Image.LANCZOS), 66
    )

    # Sombra de verdade: a silhueta preta, deslocada e borrada.
    sombra = Image.new("RGBA", (L, A), (0, 0, 0, 0))
    sombra.alpha_composite(pintar(icone, (0, 0, 0)), (96, 186))
    sombra = sombra.filter(ImageFilter.GaussianBlur(18))
    tela.alpha_composite(sombra)
    tela.alpha_composite(icone, (92, 165))

    # ── Wordmark ──────────────────────────────────────────────────────────
    wm = Image.open(WORDMARK).convert("RGBA")
    largura = 400
    altura = round(largura * wm.size[1] / wm.size[0])
    wm = pintar(wm.resize((largura, altura), Image.LANCZOS), TEXTO)
    tela.alpha_composite(wm, (452, 158))

    # ── Selo ──────────────────────────────────────────────────────────────
    # Numa camada propria: ImageDraw SUBSTITUI o alpha do pixel em vez de
    # compor, entao desenhar translucido direto na tela deixava o selo solido.
    selo = "TESTE BETA ABERTO"
    f_selo = fonte("baloo-2/700Bold/Baloo2_700Bold.ttf", 26)
    camada = Image.new("RGBA", (L, A), (0, 0, 0, 0))
    ds = ImageDraw.Draw(camada)
    cx, cy = 456, 352
    cl = ds.textlength(selo, font=f_selo)
    ds.rounded_rectangle(
        [cx, cy, cx + cl + 44, cy + 48], radius=24,
        fill=PRIMARIA + (36,), outline=PRIMARIA + (120,), width=2,
    )
    ds.text((cx + 22, cy + 25), selo, font=f_selo, fill=PRIMARIA_CLARA + (255,), anchor="lm")
    tela.alpha_composite(camada)

    # ── Chamada ───────────────────────────────────────────────────────────
    d = ImageDraw.Draw(tela)
    f_txt = fonte("nunito/700Bold/Nunito_700Bold.ttf", 32)
    d.text((456, 442), "Estude pro vestibular com questões,", font=f_txt, fill=TEXTO_2 + (255,))
    d.text((456, 484), "simulados e um plano só seu.", font=f_txt, fill=TEXTO_2 + (255,))

    tela.convert("RGB").save(SAIDA, "PNG", optimize=True)
    print(f"{SAIDA}  {SAIDA.stat().st_size // 1024} KB  {L}x{A}")


if __name__ == "__main__":
    main()
