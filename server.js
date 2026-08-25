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
import { readFileSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), 'public')
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

const PAGINA = readFileSync(join(RAIZ, 'index.html'), 'utf8')
  .replaceAll('__TESTFLIGHT_URL__', esc(TESTFLIGHT_URL))
  .replaceAll('__TESTFLIGHT_CODE__', esc(TESTFLIGHT_CODE))
  .replaceAll('__TERMOS_URL__', esc(TERMOS_URL))
  .replaceAll('__SUPORTE_EMAIL__', esc(SUPORTE_EMAIL))
  .replaceAll('__CONFIGURADO__', linkValido ? '1' : '0')

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
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
    return res.end(JSON.stringify({ ok: true, testflight: linkValido }))
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
  console.log(`[duka-beta] no ar na porta ${PORTA} — TestFlight ${linkValido ? 'configurado' : 'PENDENTE'}`)
})
