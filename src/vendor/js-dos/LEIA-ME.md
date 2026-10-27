# js-dos (empacotado sem alterações)

Estes arquivos são o **js-dos 8.5.3** (`js-dos.js`, `js-dos.css`) e o pacote **emulators 8.5.2** (`emulators/*`: DOSBox e DOSBox-X em
WebAssembly, mais `emulators.js` e `wlibzip`), copiados do npm **sem modificação**, só para o Desktop funcionar **sem internet**.

- Projeto: https://js-dos.com e https://github.com/caiiiycuk/js-dos
- Licença: **GPL-2.0** (texto em `LICENSE-GPL-2.0.txt`). O DOSBox e o DOSBox-X também são GPL. O código do Central Diogo é GPL-3.0; o js-dos
  é carregado como programa separado (numa página própria, `emulator.html`), não incorporado ao código do hub.
- Para atualizar: `npm pack js-dos emulators` e substitua estes arquivos (não precisa de mais nada).
- Não estão aqui os arquivos de depuração (`*-dbg`, `*.map`, `*.symbols`) nem a variante JSPI, só o que o Desktop usa.
