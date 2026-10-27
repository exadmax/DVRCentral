# zetajs (allotropia)

`zeta.js` é a biblioteca **zetajs 1.2.0** (licença MIT, veja `LICENSE-MIT.txt`), copiada sem alterações do pacote npm
[`zetajs`](https://www.npmjs.com/package/zetajs). Ela controla o LibreOffice/ZetaOffice (WebAssembly) pela API UNO.

Usada só pelo **LiteOffice Completo** (`src/office.html`). Os arquivos do próprio ZetaOffice (`soffice.js`, `soffice.wasm`,
`soffice.data`, ~50 MB) **não** estão no repositório: por padrão o navegador baixa do CDN do ZetaOffice
(`https://cdn.zetaoffice.net/zetaoffice_latest/`); para servir tudo daqui, veja `docs/desktop.md` (seção "LiteOffice Completo").
