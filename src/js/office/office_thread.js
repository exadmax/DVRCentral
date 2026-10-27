// LiteOffice Completo: código que roda DENTRO do LibreOffice (WebAssembly), numa thread própria. Fala com a página (office.js) por uma MessageChannel.
// Baseado no exemplo "web-office" do zetajs (MIT, allotropia). A página grava o arquivo em /tmp/office/ do sistema de arquivos do WebAssembly,
// manda "upload" e este código abre o documento; "save" grava no mesmo arquivo (mesmo formato) e avisa a página, que lê os bytes e envia ao hub.
'use strict';

let zetajs, css, desktop, xModel;

function start() {
  desktop = css.frame.Desktop.create(zetajs.getUnoComponentContext());
  zetajs.mainPort.onmessage = function (e) {
    switch (e.data.cmd) {
    case 'upload': {
      xModel = desktop.loadComponentFromURL('file:///tmp/office/' + e.data.filename, '_default', 0, []);
      xModel.getCurrentController().getFrame().getContainerWindow().FullScreen = true;      // a interface do LibreOffice ocupa todo o canvas
      zetajs.mainPort.postMessage({ cmd: 'ui_ready' });
      break;
    }
    case 'save':
      try { xModel.store(); zetajs.mainPort.postMessage({ cmd: 'saved', id: e.data.id }); }
      catch (x) { zetajs.mainPort.postMessage({ cmd: 'save_error', id: e.data.id, error: String(x && x.message || x) }); }
      break;
    case 'status':
      zetajs.mainPort.postMessage({ cmd: 'status', modified: !!(xModel && xModel.isModified()) });
      break;
    default:
      throw Error('Comando desconhecido: ' + e.data.cmd);
    }
  };
  zetajs.mainPort.postMessage({ cmd: 'thr_running' });
}

Module.zetajs.then(function (z) {
  zetajs = z;
  css = zetajs.uno.com.sun.star;
  start();
});
