"""
Troca o anexo `duka.apk` do release mais recente em ian-marchi/duka_apk pelo
`duka.apk` local, sem janela em que o botao da pagina fica sem arquivo:

  1. envia o APK novo como `duka-novo.apk`
  2. apaga o `duka.apk` antigo
  3. renomeia `duka-novo.apk` -> `duka.apk`

Usa a mesma credencial que o `git push` ja usa pra esse repositorio (Git
Credential Manager). O token nunca e impresso.

Uso, na raiz do projeto:   python scripts/publicar-apk.py [TAG]
Sem TAG, mexe no release `latest`. Com TAG (ex.: 1.2.5), cria o release se
ele nao existir e anexa o APK nele.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO = 'ian-marchi/duka_apk'
APK = 'duka.apk'
TEMP = 'duka-novo.apk'
API = f'https://api.github.com/repos/{REPO}'

if not os.path.exists(APK):
    sys.exit(f'nao achei {APK} na pasta atual — rode na raiz do projeto')

saida = subprocess.run(
    ['git', 'credential', 'fill'],
    input='protocol=https\nhost=github.com\n\n',
    capture_output=True, text=True, check=True,
).stdout
token = dict(l.split('=', 1) for l in saida.splitlines() if '=' in l).get('password')
if not token:
    sys.exit('o git nao tem credencial salva pra github.com — faca um git push antes')

CABECALHOS = {
    'Authorization': f'Bearer {token}',
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'duka-beta',
}


def api(url, metodo='GET', dados=None, tipo=None):
    h = dict(CABECALHOS)
    if tipo:
        h['Content-Type'] = tipo
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=dados, headers=h, method=metodo)) as r:
            corpo = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f'GitHub respondeu {e.code} em {metodo} {url}: {e.read().decode(errors="replace")[:300]}')
    return json.loads(corpo) if corpo else None


tag = sys.argv[1] if len(sys.argv) > 1 else None
if tag:
    try:
        release = api(f'{API}/releases/tags/{tag}')
    except SystemExit:
        release = api(f'{API}/releases', 'POST', json.dumps({
            'tag_name': tag, 'name': f'Duka {tag} (Android)', 'body': 'Build de teste',
        }).encode(), 'application/json')
        print(f'release {tag} criado')
else:
    release = api(f'{API}/releases/latest')

print(f'release {release["tag_name"]} · anexos: {[(a["name"], a["size"]) for a in release["assets"]]}')
antigo = next((a for a in release['assets'] if a['name'] == APK), None)
sobra = next((a for a in release['assets'] if a['name'] == TEMP), None)
if sobra:
    api(sobra['url'], 'DELETE')
    print('sobra de envio anterior removida')

tamanho = os.path.getsize(APK)
print(f'enviando {tamanho / 1048576:.1f} MB...', flush=True)
with open(APK, 'rb') as f:
    novo = api(
        f'https://uploads.github.com/repos/{REPO}/releases/{release["id"]}/assets?name={TEMP}',
        'POST', f.read(), 'application/vnd.android.package-archive',
    )
print(f'enviado: {novo["size"]} bytes, estado {novo["state"]}')

if antigo:
    api(antigo['url'], 'DELETE')
    print(f'anexo antigo removido ({antigo["size"]} bytes)')

novo = api(novo['url'], 'PATCH', json.dumps({'name': APK}).encode(), 'application/json')
print(f'pronto: {novo["browser_download_url"]} ({novo["size"]} bytes)')
print(f'a pagina serve por https://github.com/{REPO}/releases/latest/download/{APK}')
