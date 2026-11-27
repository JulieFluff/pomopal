// PomoPal Planner: one day as a Word file (.docx), made in the browser with no add-ons
// (Val 2026-11-27: daily notes in her private OneDrive, so Copilot can find them).
// Keeps headings (Word's navigation pane), bold, underline, bullets, clickable links and
// screenshots. A .docx is a zip of a few XML files; the zip here is stored (not squeezed).
(function initWebDocx(globalScope) {
  const enc = new TextEncoder();

  // ---- zip (stored) ----
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach(({ name, data }) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      const nameBytes = enc.encode(name);
      const crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
      local.setUint32(14, crc, true); local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, bytes);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true); entry.setUint16(12, 0, true); entry.setUint16(14, 0x21, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true);
      entry.setUint16(28, nameBytes.length, true); entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);
      offset += 30 + nameBytes.length + bytes.length;
    });
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    all.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  }

  // ---- text ----
  const xml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const BULLET = /^\s*[-*•]\s(.*)$/;
  const IMAGE_LINE = /^!\[screenshot\]\(pomopal-image:([\w-]+)\)$/;

  // A line of a note → runs of { text, bold, underline, link }.
  function runsOf(text, fmt = { bold: false, underline: false }) {
    const runs = [];
    const pattern = /\*\*(.+?)\*\*|<u>(.+?)<\/u>|(https?:\/\/[^\s<>"]+)/g;
    let last = 0;
    let m;
    while ((m = pattern.exec(text))) {
      if (m.index > last) runs.push({ text: text.slice(last, m.index), ...fmt });
      if (m[1] !== undefined) runs.push(...runsOf(m[1], { ...fmt, bold: true }));
      else if (m[2] !== undefined) runs.push(...runsOf(m[2], { ...fmt, underline: true }));
      else {
        const url = m[3].replace(/[).,;:!?'\]*]+$/, '');
        runs.push({ text: url, ...fmt, link: url });
        pattern.lastIndex = m.index + url.length;
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) runs.push({ text: text.slice(last), ...fmt });
    return runs.filter((r) => r.text);
  }

  // ---- pictures ----
  function bytesOf(dataUrl) {
    const [head, body] = String(dataUrl || '').split(',');
    const type = /data:([^;,]+)/.exec(head || '')?.[1] || '';
    const bin = globalScope.atob(body || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return { type, bytes };
  }
  function sizeOf(bytes, type) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    try {
      if (type === 'image/png' && bytes.length > 24) return { w: v.getUint32(16), h: v.getUint32(20) };
      if (type === 'image/gif' && bytes.length > 10) return { w: v.getUint16(6, true), h: v.getUint16(8, true) };
      if (type === 'image/jpeg') {
        let i = 2;
        while (i + 9 < bytes.length) {
          if (bytes[i] !== 0xFF) { i += 1; continue; }
          const marker = bytes[i + 1];
          if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return { h: v.getUint16(i + 5), w: v.getUint16(i + 7) };
          i += 2 + v.getUint16(i + 2);
        }
      }
    } catch { /* fall through */ }
    return { w: 800, h: 600 };
  }
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };

  // ---- the document ----
  // { title, sections: [{ heading, level (1 or 2), blocks: [{ text } | { note, images }] }] }
  function dayDocument({ title, sections }) {
    const rels = [];
    const media = [];
    let pictureNo = 0;
    const rel = (type, target, external) => {
      const id = `rId${rels.length + 10}`;
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
      return id;
    };
    const run = (r) => {
      // Word wants these in its own order: bold, colour, underline.
      const props = `${r.bold ? '<w:b/>' : ''}${r.link ? '<w:color w:val="0563C1"/>' : ''}${r.underline || r.link ? '<w:u w:val="single"/>' : ''}`;
      const body = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
      return r.link ? `<w:hyperlink r:id="${rel('hyperlink', r.link, true)}" w:history="1">${body}</w:hyperlink>` : body;
    };
    const para = (runs, { style, bullet } = {}) => {
      const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${bullet ? '<w:ind w:left="360" w:hanging="240"/>' : ''}`;
      const lead = bullet ? `<w:r><w:t xml:space="preserve">• </w:t></w:r>` : '';
      const body = runs.map(run).join('');
      return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${lead}${body}</w:p>`;
    };
    const picture = (image) => {
      const { type, bytes } = bytesOf(image.dataUrl);
      const ext = EXT[type];
      if (!ext || !bytes.length) return para([{ text: '[screenshot]' }]);
      pictureNo += 1;
      const name = `image${pictureNo}.${ext}`;
      media.push({ name: `word/media/${name}`, data: bytes });
      const id = rel('image', `media/${name}`);
      const { w, h } = sizeOf(bytes, type);
      const maxW = 5486400; // 6 inches
      const cx = Math.min(maxW, Math.round(w * 9525));
      const cy = Math.round(cx * (h / Math.max(1, w)));
      return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pictureNo}" name="Screenshot ${pictureNo}"/>`
        + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${pictureNo}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
        + `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
        + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    };
    // A note (light Markdown) → paragraphs.
    const note = (text, images = {}) => String(text || '').split('\n').map((line) => {
      const shot = IMAGE_LINE.exec(line.trim());
      if (shot) return images[shot[1]] ? picture(images[shot[1]]) : para([{ text: '[screenshot not found]' }]);
      const bullet = line.match(BULLET);
      return para(runsOf(bullet ? bullet[1] : line), { bullet: Boolean(bullet) });
    }).join('');

    const body = [para([{ text: title }], { style: 'Title' })];
    sections.forEach((section) => {
      body.push(para([{ text: section.heading }], { style: section.level === 2 ? 'Heading2' : 'Heading1' }));
      // Each block is a line of text, or a note (light Markdown, may hold screenshots).
      (section.blocks || []).forEach((block) => body.push(block.note !== undefined ? note(block.note, block.images) : para(runsOf(block.text))));
    });

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
      + `<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const heading = (id, name, size, level) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
      + `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/>${level === undefined ? '' : `<w:outlineLvl w:val="${level}"/>`}</w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + heading('Title', 'Title', 36) + heading('Heading1', 'heading 1', 28, 0) + heading('Heading2', 'heading 2', 24, 1)
      + '</w:styles>';
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        + `<dc:title>${xml(title)}</dc:title><dc:creator>PomoPal</dc:creator></cp:coreProperties>` },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + `${rels.join('')}</Relationships>` },
      ...media,
    ];
    return zip(files);
  }

  const exportsObject = { dayDocument, runsOf, zip, crc32, sizeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoDocx = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
