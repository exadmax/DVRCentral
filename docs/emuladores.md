# Emuladores de jogos

O app **Emuladores (consoles)** (categoria *Jogos* do menu Iniciar) roda jogos de **Mega Drive, Master System, Super Nintendo, Game Boy, Game Boy Color,
Game Boy Advance e Atari 2600** direto no navegador. O motor é o **EmulatorJS** (núcleos do RetroArch compilados para WebAssembly); nada roda no servidor.
Outros guias: [aplicativos.md](aplicativos.md) · [licencas.md](licencas.md) · [novidades.md](novidades.md).

## Usar

1. Abra **Emuladores (consoles)** no menu Iniciar e escolha o sistema.
2. **⬆ Enviar ROMs** (do aparelho) ou **📂 Da minha pasta** (de outra pasta de Meus arquivos). As ROMs ficam em `Meus arquivos/Jogos/Emuladores/<Sistema>/`.
3. Clique no jogo: ele abre numa janela própria, com tela cheia, reiniciar, save state, controles e trapaças do EmulatorJS (em português).

| Sistema | Pasta | Extensões aceitas |
|---|---|---|
| Mega Drive | `Mega Drive` | `.md` `.gen` `.smd` `.bin` |
| Master System | `Master System` | `.sms` |
| Super Nintendo | `Super Nintendo` | `.smc` `.sfc` `.swc` `.fig` |
| Game Boy | `Game Boy` | `.gb` |
| Game Boy Color | `Game Boy Color` | `.gbc` |
| Game Boy Advance | `Game Boy Advance` | `.gba` |
| Atari 2600 | `Atari 2600` | `.a26` `.bin` |

`.zip` e `.7z` valem em qualquer sistema. **O Diogows não traz nenhuma ROM**: use só jogos que você tem direito de usar (a sua própria cópia, ou jogos
livres e *homebrew*). Os saves do jogo e os *save states* ficam no navegador do aparelho (como no EmulatorJS), não no servidor.

## De onde vem o emulador

`src/emu.html` carrega o EmulatorJS de **`vendor/emulatorjs/data/`**, se essa pasta existir no hub; senão, do **CDN oficial** (`cdn.emulatorjs.org`,
versão estável). Assim o hub fica leve (nada é empacotado) e, por padrão, **este app precisa de internet** (o js-dos, o Webamp e o JS Paint, não).

Para funcionar sem internet, baixe o pacote do EmulatorJS (https://github.com/EmulatorJS/EmulatorJS, GPL-3.0) e copie a pasta `data` dele para
`src/vendor/emulatorjs/data/` (no servidor, `/opt/centraldiogo/www/vendor/emulatorjs/data/`; o `install.sh` pode apagar isso ao atualizar, refaça a cópia
depois). Os núcleos são baixados pelo próprio EmulatorJS na primeira vez que cada sistema abre; para tê-los também locais, use a pasta `data/cores` do pacote
completo. Não é preciso mexer em configuração: a cópia local, quando existe, tem prioridade.

## Verificado e não verificado

Verificado no navegador: a lista por sistema, o envio de ROM, a abertura do jogo numa janela, o carregamento do núcleo do **Game Boy** a partir do CDN e a
execução de uma ROM mínima (a animação de abertura com o logo Nintendo® apareceu).
Arquivos **`.zip`** (ROM de Game Boy) e **`.7z`** (quatro jogos de **Mega Drive** do usuário, núcleo Genesis Plus GX) abrem direto, sem extrair antes; e os
jogos de Mega Drive foram **jogados pelo dono do servidor** e funcionaram.
**Não verificado:** Master System, Super Nintendo, Game Boy Color, Game Boy Advance e Atari 2600 (mesmo código, núcleos diferentes), controles de gamepad e toque,
save states e o modo com cópia local do EmulatorJS.

## Mapa do código

| Parte | Arquivo |
|---|---|
| App (lista por sistema, envio de ROMs, janela do jogo) | `src/js/desktop/emulators.js` |
| Página do emulador (um jogo por página; aceita só ROMs da pasta do usuário) | `src/emu.html` |
| Estilos | `src/css/desktop.css` (seção *Emuladores*) |
