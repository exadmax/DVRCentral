(function (DK) {
  // ZIP mínimo, sem dependências: lê (armazenado e deflate, via DecompressionStream) e escreve (armazenado ou deflate, via CompressionStream).
  // Serve aos formatos .docx e .odt, que são pacotes ZIP. Sem ZIP64 (documentos de escritório não chegam perto de 4 GB).
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8');

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function pipe(u8, stream) {
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
  }
  const canInflate = () => typeof DecompressionStream === 'function';
  const canDeflate = () => typeof CompressionStream === 'function';

  // Lê um pacote ZIP. Devolve { 'caminho/no/zip': Uint8Array, ... }.
  async function read(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('o arquivo não é um pacote ZIP válido');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('diretório do ZIP corrompido');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (flags & 1) throw new Error('documento protegido por senha: não é possível abrir');
      if (name.endsWith('/')) continue;
      if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error('entrada do ZIP corrompida');
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = u8.subarray(start, start + csize);
      if (method === 0) out[name] = raw.slice();
      else if (method === 8) {
        if (!canInflate()) throw new Error('este navegador não descomprime ZIP (atualize o navegador)');
        out[name] = await pipe(raw, new DecompressionStream('deflate-raw'));
        if (out[name].length !== usize) throw new Error('entrada do ZIP corrompida: ' + name);
      } else throw new Error('método de compressão não suportado no ZIP (' + method + ')');
    }
    return out;
  }

  const u16 = (v, n) => { v.push(n & 255, (n >>> 8) & 255); };
  const u32 = (v, n) => { v.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); };

  // Escreve um pacote ZIP. entries = [{ name, data: Uint8Array|string, store: true }] (na ordem dada: o ODT exige o "mimetype" primeiro e sem compressão).
  async function write(entries) {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], central = [];
    let off = 0;
    for (const e of entries) {
      // e.pre = { data (já compactado), method, crc, size }: copia a entrada de outro ZIP sem descomprimir (Zip Manager)
      const raw = e.pre ? null : (typeof e.data === 'string' ? enc.encode(e.data) : e.data);
      const nameB = enc.encode(e.name), crc = e.pre ? e.pre.crc : crc32(raw), rawLen = e.pre ? e.pre.size : raw.length;
      let data = e.pre ? e.pre.data : raw, method = e.pre ? e.pre.method : 0;
      if (!e.pre && !e.store && canDeflate() && raw.length > 120) {
        try { const z = await pipe(raw, new CompressionStream('deflate-raw')); if (z.length < raw.length) { data = z; method = 8; } } catch (x) { /* guarda sem comprimir */ }
      }
      const lh = [];
      u32(lh, 0x04034b50); u16(lh, 20); u16(lh, 0x0800); u16(lh, method); u16(lh, time); u16(lh, date);
      u32(lh, crc); u32(lh, data.length); u32(lh, rawLen); u16(lh, nameB.length); u16(lh, 0);
      chunks.push(new Uint8Array(lh), nameB, data);
      const ch = [];
      u32(ch, 0x02014b50); u16(ch, 20); u16(ch, 20); u16(ch, 0x0800); u16(ch, method); u16(ch, time); u16(ch, date);
      u32(ch, crc); u32(ch, data.length); u32(ch, rawLen); u16(ch, nameB.length); u16(ch, 0); u16(ch, 0); u16(ch, 0); u16(ch, 0); u32(ch, 0); u32(ch, off);
      central.push(new Uint8Array(ch), nameB);
      off += lh.length + nameB.length + data.length;
    }
    let csize = 0;
    central.forEach(c => { csize += c.length; });
    const end = [];
    u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, entries.length); u16(end, entries.length); u32(end, csize); u32(end, off); u16(end, 0);
    return new Blob(chunks.concat(central, [new Uint8Array(end)]), { type: 'application/zip' });
  }

  DK.zip = { read: read, write: write, crc32: crc32, text: u8 => dec.decode(u8), bytes: s => enc.encode(s) };
})(window.DK = window.DK || {});
