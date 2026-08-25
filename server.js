/**
 * Duka — pagina de entrada no teste beta (TestFlight)
 *
 * Servidor minimo, ZERO dependencias: so o `http`/`fs` do Node. Escolha
 * deliberada por dois motivos:
 *   1) o projeto vive no G:, que e exFAT — `npm install` ali e lento e
 *      quebra com symlink; sem node_modules, nao ha instalacao pra quebrar;
 *   2) a pagina e uma so, estatica. Framework aqui seria peso morto.
 *
 * O que ele faz de util: injeta a configuracao (link do TestFlight, termos,
 * suporte) no HTML em tempo de boot, em vez de deixar hardcoded. Assim voce
 * troca o link pelo painel do Railway, sem tocar em codigo nem refazer deploy
 * do repositorio.
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = fileURLToPath(new URL('.', import.meta.url))
const RAIZ = join(BASE, 'public')
const PORTA = Number(process.env.PORT) || 3000

// ─────────────────────────────────────────────────────────────────────────────
// Configuracao
// ─────────────────────────────────────────────────────────────────────────────

/**
 * So aceitamos o formato oficial do link publico da Apple.
 *
 * Isto NAO e paranoia: o botao principal da pagina leva o visitante pra onde
 * esta variavel apontar. Um erro de digitacao (ou uma variavel trocada) viraria
 * um redirecionamento aberto hospedado no seu dominio — o tipo de coisa que se
 * descobre tarde. Se nao casar com o padrao, a pagina entra em "em breve" e o
 * log grita; melhor mostrar indisponivel do que mandar o aluno pra lugar nenhum.
 */
const PADRAO_TESTFLIGHT = /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]{6,12}$/

const bruto = (process.env.TESTFLIGHT_URL || '').trim()
const linkValido = PADRAO_TESTFLIGHT.test(bruto)

if (bruto && !linkValido) {
  console.warn(
    `[config] TESTFLIGHT_URL ignorada — nao casa com https://testflight.apple.com/join/CODIGO\n` +
    `         valor recebido: ${JSON.stringify(bruto)}`
  )
} else if (!bruto) {
  console.warn('[config] TESTFLIGHT_URL ausente — a pagina vai abrir no estado "em breve"')
}

const TESTFLIGHT_URL = linkValido ? bruto : ''
// O codigo de resgate e o ultimo trecho da URL: serve pro caminho manual
// (TestFlight > Resgatar) quando o link nao abre o app sozinho.
const TESTFLIGHT_CODE = linkValido ? TESTFLIGHT_URL.split('/').pop() : ''

const TERMOS_URL = (process.env.TERMOS_URL || 'https://ian-marchi.github.io/duka_politica_privacidade/').trim()
const SUPORTE_EMAIL = (process.env.SUPORTE_EMAIL || 'suporte@dukeapp.com.br').trim()

// ─────────────────────────────────────────────────────────────────────────────
// APK do Android
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O APK tem ~102 MB, e o GitHub rejeita qualquer arquivo acima de 100 MB no
 * repositorio. Por isso o caminho normal e o **GitHub Releases** (ate 2 GB por
 * anexo, fora do repositorio): sobe o arquivo la e poe a URL do anexo aqui.
 *
 * O arquivo local em `duka.apk` continua funcionando como reserva — util pra
 * rodar e testar a pagina na sua maquina sem depender de nada publicado. Em
 * producao ele nao deveria existir: cada deploy carregaria 102 MB de imagem.
 */
const apkUrlBruta = (process.env.APK_URL || '').trim()
let APK_URL = ''
if (apkUrlBruta) {
  try {
    const u = new URL(apkUrlBruta)
    // https e inegociavel: um APK baixado por http pode ser trocado no meio do
    // caminho, e a pessoa vai instalar o que chegar sem conseguir perceber.
    if (u.protocol !== 'https:') throw new Error('precisa ser https')
    APK_URL = u.href
    console.log(`[config] APK servido de ${u.host}`)
  } catch (e) {
    console.warn(`[config] APK_URL invalida (${e.message}) — ignorada: ${JSON.stringify(apkUrlBruta)}`)
  }
}

const APK_LOCAL = APK_URL ? null : ['duka.apk', join('public', 'duka.apk')]
  .map((p) => join(BASE, p))
  .find((p) => existsSync(p)) || null

if (APK_LOCAL) {
  console.log(`[config] APK local em ${APK_LOCAL} — em producao prefira APK_URL (Releases)`)
}

const APK_HREF = APK_URL || (APK_LOCAL ? '/duka.apk' : '')
const APK_DISPONIVEL = !!APK_HREF

/** Tamanho legivel, pra pessoa saber no que esta se metendo no 4G. */
function mb(bytes) {
  return (bytes / 1048576).toFixed(0) + ' MB'
}

let APK_TAMANHO = (process.env.APK_TAMANHO || '').trim()
if (!APK_TAMANHO && APK_LOCAL) {
  try { APK_TAMANHO = mb(statSync(APK_LOCAL).size) } catch { /* sem tamanho, sem drama */ }
}

const APK_VERSAO = (process.env.APK_VERSAO || '').trim()

if (!APK_DISPONIVEL) {
  console.warn('[config] sem APK_URL nem duka.apk — Android vai ver o estado "em breve"')
}

/** Escapa pra interpolacao segura dentro de atributo/texto HTML. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML montado uma vez, no boot
// ─────────────────────────────────────────────────────────────────────────────

const MOLDE = readFileSync(join(RAIZ, 'index.html'), 'utf8')

function montarPagina() {
  return MOLDE
    .replaceAll('__TESTFLIGHT_URL__', esc(TESTFLIGHT_URL))
    .replaceAll('__TESTFLIGHT_CODE__', esc(TESTFLIGHT_CODE))
    .replaceAll('__TERMOS_URL__', esc(TERMOS_URL))
    .replaceAll('__SUPORTE_EMAIL__', esc(SUPORTE_EMAIL))
    .replaceAll('__CONFIGURADO__', linkValido ? '1' : '0')
    .replaceAll('__APK_URL__', esc(APK_HREF))
    .replaceAll('__APK_DISPONIVEL__', APK_DISPONIVEL ? '1' : '0')
    .replaceAll('__APK_TAMANHO__', esc(APK_TAMANHO))
    .replaceAll('__APK_VERSAO__', esc(APK_VERSAO))
}

let PAGINA = montarPagina()

/**
 * Descobre o tamanho do APK remoto com um HEAD, pra pagina poder avisar antes
 * do toque — 102 MB no 4G nao e detalhe. Falhar aqui nao pode derrubar nada:
 * sem tamanho, a pagina so nao mostra o aviso.
 */
if (APK_URL && !APK_TAMANHO) {
  const corte = AbortSignal.timeout(5000)
  fetch(APK_URL, { method: 'HEAD', redirect: 'follow', signal: corte })
    .then((r) => {
      const n = Number(r.headers.get('content-length'))
      if (r.ok && n > 0) {
        APK_TAMANHO = mb(n)
        PAGINA = montarPagina()
        console.log(`[config] APK remoto tem ${APK_TAMANHO}`)
      }
    })
    .catch((e) => console.warn(`[config] nao deu pra medir o APK remoto: ${e.message}`))
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
}

const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

const servidor = createServer((req, res) => {
  const caminho = decodeURIComponent((req.url || '/').split('?')[0])

  if (caminho === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, testflight: linkValido, apk: APK_DISPONIVEL }))
  }

  // ── APK local ────────────────────────────────────────────────────────────
  // Reserva de desenvolvimento: em producao o arquivo vem do Releases.
  if (caminho === '/duka.apk' && APK_LOCAL) {
    let tamanho
    try { tamanho = statSync(APK_LOCAL).size } catch {
      res.writeHead(404); return res.end('404')
    }

    const cabecalhos = {
      ...SEGURANCA,
      // Sem este MIME o Android trata o arquivo como texto e nao oferece
      // instalar. O `attachment` garante que o navegador baixe em vez de
      // tentar exibir.
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="duka.apk"',
      'Accept-Ranges': 'bytes',
    }

    // 102 MB em rede movel cai com frequencia. Com Range, o navegador retoma
    // de onde parou em vez de recomecar do zero.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (range) {
      const inicio = range[1] ? Number(range[1]) : 0
      const fim = range[2] ? Number(range[2]) : tamanho - 1
      if (inicio >= tamanho || fim >= tamanho || inicio > fim) {
        res.writeHead(416, { 'Content-Range': `bytes */${tamanho}` })
        return res.end()
      }
      res.writeHead(206, {
        ...cabecalhos,
        'Content-Range': `bytes ${inicio}-${fim}/${tamanho}`,
        'Content-Length': fim - inicio + 1,
      })
      return createReadStream(APK_LOCAL, { start: inicio, end: fim }).pipe(res)
    }

    res.writeHead(200, { ...cabecalhos, 'Content-Length': tamanho })
    // Stream, nao readFileSync: carregar 102 MB na memoria a cada download
    // derrubaria o container no primeiro punhado de pessoas simultaneas.
    return createReadStream(APK_LOCAL).pipe(res)
  }

  if (caminho === '/' || caminho === '/index.html') {
    res.writeHead(200, { ...SEGURANCA, 'Content-Type': TIPOS['.html'], 'Cache-Control': 'no-cache' })
    return res.end(PAGINA)
  }

  // Estatico. `normalize` + a checagem de prefixo impedem `../` de escapar
  // da pasta public e servir qualquer arquivo do container.
  const alvo = normalize(join(RAIZ, caminho))
  if (!alvo.startsWith(RAIZ)) {
    res.writeHead(403)
    return res.end('403')
  }

  try {
    const corpo = readFileSync(alvo)
    res.writeHead(200, {
      ...SEGURANCA,
      'Content-Type': TIPOS[extname(alvo)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    })
    res.end(corpo)
  } catch {
    res.writeHead(404, { ...SEGURANCA, 'Content-Type': TIPOS['.html'] })
    res.end('<meta charset="utf-8"><p style="font:16px system-ui">Pagina nao encontrada. <a href="/">Voltar</a></p>')
  }
})

servidor.listen(PORTA, '0.0.0.0', () => {
  console.log(
    `[duka-beta] no ar na porta ${PORTA} — ` +
    `TestFlight ${linkValido ? 'configurado' : 'PENDENTE'}, ` +
    `APK ${APK_DISPONIVEL ? (APK_URL ? 'remoto' : 'local') : 'PENDENTE'}`
  )
})
