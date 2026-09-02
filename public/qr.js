/**
 * Gerador de QR Code — modo byte, correcao de erro nivel M, versoes 1 a 6.
 *
 * Escrito a mao porque a pagina nao carrega nada de fora: um <script> de CDN
 * seria um terceiro entre voce e quem vai instalar o app, e a pagina inteira
 * existe justamente pra ser confiavel nesse momento.
 *
 * O teto na versao 6 e proposital. Versao 6 nivel M guarda 106 bytes — mais do
 * que qualquer URL deste site vai ter — e parar ai dispensa os blocos de
 * "informacao de versao", que so existem da versao 7 pra cima. Menos tabela,
 * menos superficie pra errar. Acima disso `gerar()` devolve null, e quem chama
 * mostra o endereco em texto.
 *
 * Conferido modulo a modulo contra o segno (implementacao de referencia em
 * Python) — ver scripts/conferir-qr.mjs.
 */
(function (global) {
  'use strict'

  // ── Tabelas, so pras versoes 1..6 em nivel M ─────────────────────────────
  // [total de codewords, codewords de correcao por bloco, numero de blocos]
  var VERSOES = {
    1: [26, 10, 1],
    2: [44, 16, 1],
    3: [70, 26, 1],
    4: [100, 18, 2],
    5: [134, 24, 2],
    6: [172, 16, 4],
  }

  // Centro dos padroes de alinhamento (alem do 6, que e sempre o primeiro).
  var ALINHAMENTO = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] }

  var MAX_VERSAO = 6

  // ── Campo de Galois GF(256), polinomio primitivo 0x11D ───────────────────
  var EXP = new Uint8Array(512)
  var LOG = new Uint8Array(256)
  ;(function () {
    var x = 1
    for (var i = 0; i < 255; i++) {
      EXP[i] = x
      LOG[x] = i
      x <<= 1
      if (x & 0x100) x ^= 0x11d
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255]
  })()

  function mul(a, b) {
    if (a === 0 || b === 0) return 0
    return EXP[LOG[a] + LOG[b]]
  }

  /** Polinomio gerador de grau `grau`, pra Reed-Solomon. */
  function gerador(grau) {
    var g = [1]
    for (var i = 0; i < grau; i++) {
      var novo = new Array(g.length + 1).fill(0)
      for (var j = 0; j < g.length; j++) {
        novo[j] ^= g[j]
        novo[j + 1] ^= mul(g[j], EXP[i])
      }
      g = novo
    }
    return g
  }

  /** Resto da divisao — sao os codewords de correcao do bloco. */
  function correcao(dados, quantos) {
    var g = gerador(quantos)
    var resto = new Array(quantos).fill(0)
    for (var i = 0; i < dados.length; i++) {
      var fator = dados[i] ^ resto[0]
      resto.shift()
      resto.push(0)
      for (var j = 0; j < quantos; j++) resto[j] ^= mul(g[j + 1], fator)
    }
    return resto
  }

  // ── Bits ─────────────────────────────────────────────────────────────────
  function Bits() {
    this.v = []
  }
  Bits.prototype.push = function (valor, tamanho) {
    for (var i = tamanho - 1; i >= 0; i--) this.v.push((valor >>> i) & 1)
  }

  // ── Codificacao ──────────────────────────────────────────────────────────
  function escolherVersao(nBytes) {
    for (var v = 1; v <= MAX_VERSAO; v++) {
      var t = VERSOES[v]
      var dados = t[0] - t[1] * t[2]
      // 4 bits de modo + 8 bits de contagem = 12 bits de cabecalho
      if (dados * 8 >= 12 + nBytes * 8) return v
    }
    return null
  }

  function codificar(bytes, versao) {
    var t = VERSOES[versao]
    var totalDados = t[0] - t[1] * t[2]

    var b = new Bits()
    b.push(4, 4) // modo byte
    b.push(bytes.length, 8) // contagem (8 bits vale ate a versao 9)
    for (var i = 0; i < bytes.length; i++) b.push(bytes[i], 8)

    // Terminador de ate 4 bits, depois completa o ultimo byte.
    var capacidade = totalDados * 8
    var sobra = Math.min(4, capacidade - b.v.length)
    b.push(0, sobra)
    while (b.v.length % 8 !== 0) b.v.push(0)

    var cw = []
    for (var k = 0; k < b.v.length; k += 8) {
      var byte = 0
      for (var m = 0; m < 8; m++) byte = (byte << 1) | b.v[k + m]
      cw.push(byte)
    }
    // Enchimento alternado, definido pela norma.
    var enchimento = [0xec, 0x11]
    for (var n = 0; cw.length < totalDados; n++) cw.push(enchimento[n % 2])

    // Divide em blocos: os primeiros ficam com um codeword a menos quando a
    // divisao nao e exata.
    var nBlocos = t[2]
    var ecPorBloco = t[1]
    var curtos = nBlocos - (totalDados % nBlocos)
    var tamCurto = Math.floor(totalDados / nBlocos)

    var blocosDados = []
    var blocosEc = []
    var pos = 0
    for (var ib = 0; ib < nBlocos; ib++) {
      var tam = tamCurto + (ib < curtos ? 0 : 1)
      var bloco = cw.slice(pos, pos + tam)
      pos += tam
      blocosDados.push(bloco)
      blocosEc.push(correcao(bloco, ecPorBloco))
    }

    // Intercala: todos os dados coluna a coluna, depois toda a correcao.
    var saida = []
    var maiorDados = Math.max.apply(null, blocosDados.map(function (x) { return x.length }))
    for (var c = 0; c < maiorDados; c++) {
      for (var ii = 0; ii < nBlocos; ii++) {
        if (c < blocosDados[ii].length) saida.push(blocosDados[ii][c])
      }
    }
    for (var ce = 0; ce < ecPorBloco; ce++) {
      for (var ie = 0; ie < nBlocos; ie++) saida.push(blocosEc[ie][ce])
    }
    return saida
  }

  // ── Matriz ───────────────────────────────────────────────────────────────
  function novaMatriz(tamanho) {
    var m = []
    for (var i = 0; i < tamanho; i++) m.push(new Array(tamanho).fill(null))
    return m
  }

  function porFinder(m, linha, coluna) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var y = linha + r
        var x = coluna + c
        if (y < 0 || y >= m.length || x < 0 || x >= m.length) continue
        var borda = r === -1 || r === 7 || c === -1 || c === 7
        var dentro = r >= 2 && r <= 4 && c >= 2 && c <= 4
        var anel = (r === 0 || r === 6) && c >= 0 && c <= 6
        var lados = (c === 0 || c === 6) && r >= 0 && r <= 6
        m[y][x] = borda ? 0 : dentro || anel || lados ? 1 : 0
      }
    }
  }

  function porAlinhamento(m, versao) {
    var centros = ALINHAMENTO[versao]
    for (var a = 0; a < centros.length; a++) {
      for (var b2 = 0; b2 < centros.length; b2++) {
        var linha = centros[a]
        var coluna = centros[b2]
        if (m[linha][coluna] !== null) continue // colide com um finder
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            var borda = Math.max(Math.abs(r), Math.abs(c))
            m[linha + r][coluna + c] = borda === 1 ? 0 : 1
          }
        }
      }
    }
  }

  function porFuncoes(m, versao) {
    var n = m.length
    porFinder(m, 0, 0)
    porFinder(m, 0, n - 7)
    porFinder(m, n - 7, 0)
    porAlinhamento(m, versao)

    // Linhas de tempo
    for (var i = 8; i < n - 8; i++) {
      var v = i % 2 === 0 ? 1 : 0
      if (m[6][i] === null) m[6][i] = v
      if (m[i][6] === null) m[i][6] = v
    }
    // Modulo escuro, sempre em (4*versao + 9, 8)
    m[4 * versao + 9][8] = 1
  }

  /** Reserva o espaco da informacao de formato pra ele nao receber dados. */
  function reservarFormato(m) {
    var n = m.length
    for (var i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = 2
      if (m[i][8] === null) m[i][8] = 2
    }
    for (var j = 0; j < 8; j++) {
      if (m[8][n - 1 - j] === null) m[8][n - 1 - j] = 2
      if (m[n - 1 - j][8] === null) m[n - 1 - j][8] = 2
    }
  }

  function porDados(m, cw) {
    var n = m.length
    var bit = 0
    var total = cw.length * 8
    var subindo = true

    for (var direita = n - 1; direita > 0; direita -= 2) {
      if (direita === 6) direita-- // a coluna de tempo nao entra
      for (var passo = 0; passo < n; passo++) {
        var y = subindo ? n - 1 - passo : passo
        for (var lado = 0; lado < 2; lado++) {
          var x = direita - lado
          if (m[y][x] !== null) continue
          var valor = 0
          if (bit < total) valor = (cw[bit >>> 3] >>> (7 - (bit & 7))) & 1
          m[y][x] = valor
          bit++
        }
      }
      subindo = !subindo
    }
  }

  function mascarar(y, x, padrao) {
    switch (padrao) {
      case 0: return (y + x) % 2 === 0
      case 1: return y % 2 === 0
      case 2: return x % 3 === 0
      case 3: return (y + x) % 3 === 0
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
      case 5: return ((y * x) % 2) + ((y * x) % 3) === 0
      case 6: return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0
      default: return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0
    }
  }

  /** BCH(15,5) da informacao de formato, com o XOR fixo da norma. */
  function bitsDeFormato(nivel, mascara) {
    var dados = (nivel << 3) | mascara
    var resto = dados
    for (var i = 0; i < 10; i++) {
      resto <<= 1
      if (resto & 0x400) resto ^= 0x537
    }
    return (((dados << 10) | resto) ^ 0x5412) & 0x7fff
  }

  function porFormato(m, mascara) {
    var n = m.length
    // Nivel M vale 0 na norma; quem vale 1 e o nivel L. Trocar os dois nao
    // quebra o desenho — gera um QR que a camera le como se fosse outro nivel
    // de correcao e falha na conferencia, sem nenhum sinal visivel.
    var bits = bitsDeFormato(0, mascara)

    for (var i = 0; i < 15; i++) {
      var b = (bits >>> i) & 1

      // Copia junto ao finder superior esquerdo: desce a coluna 8 e depois
      // anda pela linha 8. (m e [linha][coluna] — inverter os dois aqui foi
      // exatamente o erro que a conferencia contra o segno pegou.)
      if (i < 6) m[i][8] = b
      else if (i === 6) m[7][8] = b
      else if (i === 7) m[8][8] = b
      else if (i === 8) m[8][7] = b
      else m[8][14 - i] = b

      // Copia espelhada, junto aos outros dois finders
      if (i < 8) m[8][n - 1 - i] = b
      else m[n - 15 + i][8] = b
    }
  }

  function penalidade(m) {
    var n = m.length
    var total = 0
    var escuros = 0

    // Regra 1: sequencias de 5 ou mais
    for (var eixo = 0; eixo < 2; eixo++) {
      for (var i = 0; i < n; i++) {
        var atual = -1
        var seq = 0
        for (var j = 0; j < n; j++) {
          var v = eixo === 0 ? m[i][j] : m[j][i]
          if (v === atual) {
            seq++
          } else {
            if (seq >= 5) total += 3 + (seq - 5)
            atual = v
            seq = 1
          }
        }
        if (seq >= 5) total += 3 + (seq - 5)
      }
    }

    // Regra 2: blocos 2x2 da mesma cor
    for (var y = 0; y < n - 1; y++) {
      for (var x = 0; x < n - 1; x++) {
        var a = m[y][x]
        if (a === m[y][x + 1] && a === m[y + 1][x] && a === m[y + 1][x + 1]) total += 3
      }
    }

    // Regra 3: o desenho que imita um finder
    var alvo1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    var alvo2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    for (var e2 = 0; e2 < 2; e2++) {
      for (var i2 = 0; i2 < n; i2++) {
        for (var j2 = 0; j2 + 11 <= n; j2++) {
          var casa1 = true
          var casa2 = true
          for (var k = 0; k < 11; k++) {
            var vv = e2 === 0 ? m[i2][j2 + k] : m[j2 + k][i2]
            if (vv !== alvo1[k]) casa1 = false
            if (vv !== alvo2[k]) casa2 = false
          }
          if (casa1) total += 40
          if (casa2) total += 40
        }
      }
    }

    // Regra 4: desequilibrio entre claro e escuro
    for (var y2 = 0; y2 < n; y2++) {
      for (var x2 = 0; x2 < n; x2++) if (m[y2][x2] === 1) escuros++
    }
    var proporcao = (escuros * 100) / (n * n)
    total += Math.floor(Math.abs(proporcao - 50) / 5) * 10

    return total
  }

  /**
   * Devolve { tamanho, modulos } ou null se o texto nao couber ate a versao 6.
   */
  function gerar(texto) {
    var bytes = new TextEncoder().encode(texto)
    var versao = escolherVersao(bytes.length)
    if (!versao) return null

    var cw = codificar(bytes, versao)
    var n = versao * 4 + 17

    var base = novaMatriz(n)
    porFuncoes(base, versao)
    reservarFormato(base)

    // Guarda o que e funcao: essas posicoes nao levam mascara.
    var ehFuncao = []
    for (var y = 0; y < n; y++) {
      ehFuncao.push([])
      for (var x = 0; x < n; x++) ehFuncao[y].push(base[y][x] !== null)
    }

    porDados(base, cw)

    var melhor = null
    var melhorNota = Infinity
    for (var mask = 0; mask < 8; mask++) {
      var m = []
      for (var yy = 0; yy < n; yy++) {
        m.push([])
        for (var xx = 0; xx < n; xx++) {
          var v = base[yy][xx]
          if (v === 2) v = 0 // espaco reservado do formato
          if (!ehFuncao[yy][xx] && mascarar(yy, xx, mask)) v ^= 1
          m[yy].push(v)
        }
      }
      porFormato(m, mask)
      var nota = penalidade(m)
      if (nota < melhorNota) {
        melhorNota = nota
        melhor = m
      }
    }

    // `codewords` sai junto pra conferencia poder comparar a codificacao
    // isolada, sem depender de ler de volta a matriz.
    return { tamanho: n, modulos: melhor, versao: versao, codewords: cw }
  }

  /** Monta o SVG do QR, com a margem de 4 modulos que a norma exige. */
  function svg(texto, opcoes) {
    var qr = gerar(texto)
    if (!qr) return null
    var o = opcoes || {}
    var margem = o.margem == null ? 4 : o.margem
    var lado = qr.tamanho + margem * 2
    var claro = o.claro || '#ffffff'
    var escuro = o.escuro || '#000000'

    var caminho = ''
    for (var y = 0; y < qr.tamanho; y++) {
      for (var x = 0; x < qr.tamanho; x++) {
        if (qr.modulos[y][x] === 1) {
          caminho += 'M' + (x + margem) + ' ' + (y + margem) + 'h1v1h-1z'
        }
      }
    }

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + lado + ' ' + lado + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="QR Code com o endereco desta pagina">' +
      '<rect width="' + lado + '" height="' + lado + '" fill="' + claro + '" rx="1.5"/>' +
      '<path d="' + caminho + '" fill="' + escuro + '"/></svg>'
    )
  }

  global.DukaQR = { gerar: gerar, svg: svg }
})(typeof window !== 'undefined' ? window : globalThis)
