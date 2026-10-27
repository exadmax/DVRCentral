(function (DK) {
  // LiteOffice Completo: abre um arquivo no LibreOffice completo (WebAssembly), que roda no navegador de quem usa, sem pesar no servidor.
  // Fica numa página própria (office.html), porque precisa de cabeçalhos de isolamento que o resto do Diogows não pode ter. Abre numa nova aba.
  // Edita .docx .odt .doc .rtf, .xlsx .ods .xls .csv, .pptx .odp .ppt e mais, com todos os recursos do LibreOffice. Veja docs/desktop.md.
  const OFFICE_RE = /\.(docx?|dotx?|odt|rtf|xlsx?|xltx?|ods|csv|pptx?|potx?|odp|odg)$/i;
  DK.isOfficeFile = it => it && it.type !== 'dir' && OFFICE_RE.test(it.name || '');

  DK.officeApp = function (o) {
    const it = o && o.item;
    if (!it) { DK.pickFile('office', 'Abrir no LiteOffice Completo', x => DK.officeApp({ item: x })); return; }
    const url = 'office.html?space=' + encodeURIComponent(it.space) + (it.sudo ? '&sudo=1' : '') + '&path=' + encodeURIComponent(it.path);
    const w = window.open(url, '_blank');
    if (!w) DK.toast('O navegador bloqueou a nova janela. Permita pop-ups deste endereço e tente de novo.');
    else if (!window.isSecureContext) DK.toast('Atenção: o LibreOffice completo só roda em HTTPS ou localhost; veja a seção LiteOffice Completo em docs/desktop.md.');
  };

  DK.register({ id: 'officefull', icon: '🏢', label: 'LiteOffice Completo (LibreOffice)', open: () => DK.officeApp() });
})(window.DK = window.DK || {});
