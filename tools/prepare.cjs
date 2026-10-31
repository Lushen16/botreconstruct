const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function readAsar(buffer) {
  if (buffer.length < 16) throw new Error('ASAR truncado');
  const headerSize = buffer.readUInt32LE(4);
  const jsonSize = buffer.readUInt32LE(12);
  if (headerSize > buffer.length - 8 || jsonSize > headerSize - 8) throw new Error('Header ASAR inválido');
  const header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString('utf8'));
  const entries = [];
  function visit(directory, prefix = '') {
    for (const [name, entry] of Object.entries(directory.files || {})) {
      if (!name || name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
        throw new Error('Nome ASAR inseguro');
      }
      const relative = prefix + name;
      if (entry.files) visit(entry, relative + '/');
      else {
        if (entry.link || entry.unpacked) throw new Error('Entrada externa exige tratamento explícito: ' + relative);
        const offset = Number(entry.offset);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(entry.size) || entry.size < 0) {
          throw new Error('Intervalo ASAR inválido: ' + relative);
        }
        const start = 8 + headerSize + offset;
        const end = start + entry.size;
        if (!Number.isSafeInteger(end) || end > buffer.length) throw new Error('Entrada ASAR truncada: ' + relative);
        const bytes = buffer.subarray(start, end);
        const digest = sha256(bytes);
        if (entry.integrity && (entry.integrity.algorithm !== 'SHA256' || entry.integrity.hash !== digest)) {
          throw new Error('Integridade divergente: ' + relative);
        }
        entries.push({ relative, bytes, file_offset: start, sha256: digest });
      }
    }
  }
  visit(header);
  return { entries, header_sha256: sha256(buffer.subarray(16, 16 + jsonSize)) };
}

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visitor(node);
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(child)) child.forEach((item) => walk(item, visitor));
    else if (child && typeof child === 'object') walk(child, visitor);
  }
}

function normalizedAst(node) {
  return JSON.parse(JSON.stringify(node, (key, value) => {
    if (['start', 'end', 'loc', 'raw'].includes(key)) return undefined;
    if (value instanceof RegExp) return { pattern: value.source, flags: value.flags };
    if (typeof value === 'bigint') return String(value);
    return value;
  }));
}

function bytecodeFacts(entry) {
  const bytes = entry.bytes;
  const strings = [];
  const regex = /[\x20-\x7e]{5,}/g;
  const binary = bytes.toString('latin1');
  for (const match of binary.matchAll(regex)) strings.push({ file_offset: match.index, value: match[0] });
  const header = [];
  for (let offset = 0; offset < Math.min(28, bytes.length); offset += 4) {
    if (offset + 4 <= bytes.length) header.push({ offset, uint32_le: bytes.readUInt32LE(offset) });
  }
  return { file: entry.relative, sha256: entry.sha256, bytes: bytes.length, header,
    string_extraction: 'ASCII byte runs; not a decoded V8 string table', strings,
    source_recovered: false, control_flow_recovered: false };
}

function ipcFacts(ast, source, file) {
  const apis = [];
  const operations = [];
  const wrappers = new Map();
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier'
        || !['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) return;
    const parameter = node.init.params[0]?.name;
    walk(node.init.body, (call) => {
      const channel = call.arguments?.[0];
      if (call.type === 'CallExpression' && call.callee.type === 'MemberExpression'
          && call.callee.property.name === 'invoke' && call.callee.object.name === 'ipcRenderer'
          && channel?.type === 'TemplateLiteral' && channel.expressions.length === 1
          && channel.expressions[0].name === parameter) {
        wrappers.set(node.id.name, { prefix: channel.quasis[0].value.cooked, suffix: channel.quasis[1].value.cooked });
      }
    });
  });
  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return;
    const member = node.callee.property.name;
    if (node.callee.object.name === 'ipcRenderer' && ['invoke', 'send', 'on', 'removeListener'].includes(member)) {
      const channel = node.arguments[0];
      operations.push({ file, line: node.loc.start.line, operation: member,
        channel: channel?.type === 'Literal' ? channel.value : null,
        dynamic: channel?.type !== 'Literal', expression: source.slice(channel?.start, channel?.end) });
    }
    if (member !== 'exposeInMainWorld' || node.arguments[1]?.type !== 'ObjectExpression') return;
    const namespace = node.arguments[0]?.value;
    for (const property of node.arguments[1].properties) {
      const channels = [];
      walk(property.value, (call) => {
        if (call.type !== 'CallExpression') return;
        const first = call.arguments[0];
        if (first?.type !== 'Literal' || typeof first.value !== 'string') return;
        if (call.callee.type === 'MemberExpression' && call.callee.object.name === 'ipcRenderer') {
          const operation = call.callee.property.name;
          if (['invoke', 'send', 'on'].includes(operation)) channels.push({ channel: first.value, operation, resolution: 'literal' });
        }
        if (call.callee.type === 'Identifier' && wrappers.has(call.callee.name)) {
          const wrapper = wrappers.get(call.callee.name);
          channels.push({ channel: wrapper.prefix + first.value + wrapper.suffix, operation: 'invoke', resolution: 'static-wrapper' });
        }
      });
      apis.push({ file, line: property.loc.start.line, namespace, method: property.key.name ?? property.key.value, channels });
    }
  });
  return { apis, operations };
}

async function prepare({ asar, extracted, output, acorn, prettier }) {
  const archive = fs.readFileSync(asar);
  const { entries, header_sha256 } = readAsar(archive);
  const inventory = [];
  const bytecodes = [];
  const contract = { authority: 'static-source', runtime_verified: false, apis: [], operations: [] };
  const parse = (text) => acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  fs.mkdirSync(output, { recursive: true });
  for (const entry of entries) {
    const existing = path.resolve(extracted, entry.relative);
    if (!existing.startsWith(path.resolve(extracted) + path.sep)) throw new Error('Caminho fora da extração');
    const matches = fs.existsSync(existing) && sha256(fs.readFileSync(existing)) === entry.sha256;
    const record = { path: entry.relative, bytes: entry.bytes.length, sha256: entry.sha256,
      asar_file_offset: entry.file_offset, antigravity_matches: matches, readable: null };
    if (/\.(c?js)$/.test(entry.relative)) {
      const text = entry.bytes.toString('utf8');
      const ast = parse(text);
      const formatted = await prettier.format(text, { parser: 'babel' });
      if (JSON.stringify(normalizedAst(ast)) !== JSON.stringify(normalizedAst(parse(formatted)))) {
        throw new Error('AST alterada pela formatação: ' + entry.relative);
      }
      const target = path.join(output, 'readable', entry.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, formatted);
      record.readable = { path: path.relative(output, target), sha256: sha256(Buffer.from(formatted)), ast_verified: true };
      if (entry.relative.endsWith('preload.cjs')) {
        const found = ipcFacts(ast, text, entry.relative);
        contract.apis.push(...found.apis);
        contract.operations.push(...found.operations);
      }
    } else if (entry.relative.endsWith('.jsc')) bytecodes.push(bytecodeFacts(entry));
    inventory.push(record);
  }
  const manifest = { artifact: path.resolve(asar), sha256: sha256(archive), header_json_sha256: header_sha256,
    entries: inventory, counts: { files: inventory.length,
      matching_extracted: inventory.filter((entry) => entry.antigravity_matches).length,
      readable: inventory.filter((entry) => entry.readable).length, bytecodes: bytecodes.length },
    limits: ['Static recovery only', 'No JSC module execution', 'No native automation implementation recovered'] };
  for (const [name, data] of Object.entries({ 'inventory.json': manifest, 'ipc_contracts.json': contract,
    'bytecode_inventory.json': bytecodes })) fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
  return manifest.counts;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  const acornRoot = process.env.PKA_ACORN_ROOT;
  const prettierRoot = process.env.PKA_PRETTIER_ROOT;
  if (!acornRoot || !prettierRoot) throw new Error('Defina PKA_ACORN_ROOT e PKA_PRETTIER_ROOT para ferramentas locais');
  prepare({ asar: path.join(root, 'Shiba_Bots_App/dll/resources/app.asar'),
    extracted: path.join(root, 'Extracted_Source'), output: path.resolve(__dirname, '..'),
    acorn: require(acornRoot), prettier: require(prettierRoot) })
    .then((counts) => console.log(JSON.stringify(counts)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { readAsar, bytecodeFacts, ipcFacts, normalizedAst, prepare };
