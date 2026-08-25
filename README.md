# duka_apple_testflight

Página de entrada no **teste beta do Duka** via TestFlight. Substitui o link da
App Store enquanto o app não está publicado.

Uma página, sem framework, **sem dependências** — só o `http`/`fs` do Node. O
`npm install` aqui não instala nada, e isso é de propósito: o projeto vive no
`G:`, que é exFAT, onde instalação de pacote é lenta e quebra com symlink.

## Como funciona

O visitante cai na página e vê o caminho certo pro aparelho dele:

| Situação | O que aparece |
|---|---|
| iPhone / iPad | Os 3 passos: instalar TestFlight → entrar no teste → instalar |
| Android | Download do APK + os 4 passos de instalação fora da Play Store |
| Computador | "Abra no seu celular" + endereço para copiar |
| `TESTFLIGHT_URL` ausente no iPhone | "As vagas abrem em breve" |
| Sem APK no Android | "A versão Android sai em breve" + suporte |

As duas distribuições são **independentes**: TestFlight pendente não impede o
download do Android, e vice-versa.

O código de resgate (os 8 caracteres finais do link) aparece na tela com botão
de copiar, pro caso do link não abrir o TestFlight sozinho — aí é
*TestFlight → Resgatar → colar*.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | O que é |
|---|---|---|---|
| `TESTFLIGHT_URL` | **sim** | — | `https://testflight.apple.com/join/CODIGO` |
| `APK_URL` | **sim, para Android** | — | URL https do APK (GitHub Releases) |
| `TERMOS_URL` | não | GitHub Pages do `duka_politica_privacidade` | Termos, Privacidade e Termo de Teste Beta |
| `SUPORTE_EMAIL` | não | `suporte@dukeapp.com.br` | Destino dos links de suporte |
| `APK_VERSAO` | não | tag do release | Só para fixar o texto na mão |
| `APK_TAMANHO` | não | tamanho do anexo | Só para fixar o texto na mão |
| `PORT` | não | `3000` | O Railway injeta sozinho |

### Por que a `TESTFLIGHT_URL` é validada

O servidor só aceita o formato oficial da Apple
(`^https://testflight\.apple\.com/join/[A-Za-z0-9]{6,12}$`). Se não casar, a
variável é **ignorada**, a página entra no estado "em breve" e o log avisa.

Isso não é frescura: o botão principal manda o visitante pra onde essa variável
apontar. Uma variável trocada por engano viraria um redirecionamento aberto
hospedado no seu domínio. Melhor mostrar "em breve" do que mandar aluno pra
lugar errado.

## O APK não pode ir no repositório

`duka.apk` tem **102,1 MB**. O GitHub rejeita qualquer arquivo acima de
**100 MB** dentro do repositório — `git push` falha, e o upload de arquivo pela
interface web para em 25 MB. Por isso o `.gitignore` exclui `*.apk`.

O lugar dele é o **GitHub Releases**, que é outra coisa: anexo de release aceita
até **2 GB**, inclusive pelo navegador (arrastando o arquivo). Fica fora do
repositório, não infla o histórico e não passa pelo Railway.

```bash
gh release create v1.2.4 duka.apk --repo ian-marchi/duka_apk --title "Duka 1.2.4 (Android)" --notes "Build de teste"
```

Ou pelo site: **Releases → Draft a new release → Attach binaries**.

> **O repositório precisa ser público.** Anexo de release em repo privado não
> baixa sem login — o botão daria erro para todo mundo que não é você.
>
> **Git LFS não serve aqui.** Ele aceitaria o arquivo, mas a cota gratuita do
> GitHub é 1 GB de banda por mês: dez downloads de 102 MB e o botão para de
> funcionar até o mês virar.

### A `APK_URL` se configura uma vez só

Use a URL de **`latest`**, não a de uma tag fixa:

```
https://github.com/ian-marchi/duka_apk/releases/latest/download/duka.apk
```

O GitHub redireciona esse endereço para o anexo com esse nome no release mais
recente. Publicar uma versão nova **não exige mexer em nada aqui** — só duas
condições:

- o anexo tem que continuar se chamando `duka.apk`
- o release não pode ser *draft* nem *pre-release* (o "latest" ignora os dois)

Ou seja, o ciclo de atualização inteiro é:

```bash
gh release create v1.2.5 duka.apk --repo ian-marchi/duka_apk --title "Duka 1.2.5 (Android)" --notes "..."
```

E acabou. A página passa a servir o arquivo novo, e a **versão e o tamanho
exibidos se atualizam sozinhos**: o servidor consulta a API pública do GitHub no
boot e periodicamente, lê a `tag_name` e o tamanho do anexo. Nenhuma variável
muda de mão em mão.

Se a sondagem encontrar o repositório sem nenhum release publicado, ou um
release sem o anexo esperado, o Android vê **"a versão Android sai em breve"** em
vez de um botão que dá erro. Falha de rede não derruba nada — nesse caso a
configuração atual é mantida.

### Arquivo local (só desenvolvimento)

Se existir `duka.apk` na raiz (ou em `public/`) e `APK_URL` não estiver
definida, o servidor serve o arquivo em `/duka.apk` — com o MIME
`application/vnd.android.package-archive` (sem ele o Android não oferece
instalar), `Content-Disposition: attachment`, streaming e suporte a `Range`
para retomar download caído.

Em produção prefira sempre a `APK_URL`: com o arquivo local, cada deploy
carregaria 102 MB de imagem e todo download sairia da banda do Railway.

## Rodar local

```bash
TESTFLIGHT_URL="https://testflight.apple.com/join/SEUCODIGO" node server.js
```

No PowerShell:

```powershell
$env:TESTFLIGHT_URL="https://testflight.apple.com/join/SEUCODIGO"; node server.js
```

Abre em `http://localhost:3000`. Para ver o fluxo do iPhone no computador, use o
modo dispositivo do DevTools com um user agent de iPhone — a detecção é por
`navigator.userAgent` + `maxTouchPoints`.

## Publicar no Railway

1. `railway link` (ou conectar `ian-marchi/duka_apk` pelo painel)
2. No painel → **Variables** → adicionar `TESTFLIGHT_URL` e `APK_URL`
3. **Settings → Networking → Generate Domain**
4. Push na `main` faz deploy sozinho

O `railway.json` já define o healthcheck em `/health`, que responde
`{"ok":true,"testflight":true|false,"apk":true|false}` — dá pra saber pelo
monitor se o link e o APK estão de pé, sem abrir a página.

## Onde nasce a `TESTFLIGHT_URL`

App Store Connect → **TestFlight** → seu grupo externo → **Ativar link público**
→ definir o teto de testadores. A Apple gera o link na hora.

Exige uma build aprovada no **Beta App Review**. Sem isso, o link existe mas
ninguém consegue instalar.

## Identidade visual

Tokens espelhados de `Path_app/apps/mobile/theme/`: cores do `colors.ts` no
preset `roxo:vibrante` de `presets.ts`, raio e borda do `clay.ts`, fontes
Baloo 2 (display) e Nunito (corpo). Logo do elefante inline, vindo do
`LOGO APP.svg`.

O wordmark "Duka" é **texto em Barlow 500**, não imagem — a mesma fonte que o
`icons/duka-wordmark-limpo.svg` declara. Assim ele escala, muda de cor e não
pesa. Se você quiser o PNG vetorizado no lugar, é trocar o `<p class="wordmark">`.

## Manutenção

Builds do TestFlight **expiram em 90 dias**. Quando a última expirar, o link
público para de aceitar entradas e mostra "este beta não está aceitando
testadores". Suba uma build nova antes disso.

Quando o app for publicado na App Store, esta página sai de cena — o link vira
`apps.apple.com`.
