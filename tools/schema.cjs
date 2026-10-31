const fs = require('node:fs');
const path = require('node:path');
const { normalizedAst } = require('./prepare.cjs');

const closureBrand = Symbol('literal-lambda');

function literalEvaluator() {
  let remaining = 100000;
  function evaluate(node, environment, depth = 0) {
    if (--remaining < 0 || depth > 100) throw new Error('Orçamento de interpretação excedido');
    const read = (child, scope = environment) => evaluate(child, scope, depth + 1);
    if (!node) throw new Error('Expressão ausente');
    switch (node.type) {
      case 'Literal': return node.value;
      case 'Identifier':
        if (!environment.has(node.name)) throw new Error('Identificador fora do DSL: ' + node.name);
        return environment.get(node.name);
      case 'ArrowFunctionExpression':
        if (!node.expression || node.async) throw new Error('DSL aceita apenas lambdas de expressão');
        return { [closureBrand]: true, node, environment };
      case 'ArrayExpression': return node.elements.map((element) => read(element));
      case 'ObjectExpression': {
        const result = Object.create(null);
        for (const property of node.properties) {
          if (property.type === 'SpreadElement') Object.assign(result, read(property.argument));
          else {
            if (property.kind !== 'init' || property.method) throw new Error('Propriedade fora do DSL');
            const key = property.computed ? read(property.key) : property.key.name ?? property.key.value;
            if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Chave reservada');
            result[key] = read(property.value);
          }
        }
        return result;
      }
      case 'UnaryExpression': {
        const argument = read(node.argument);
        if (node.operator === '!') return !argument;
        if (node.operator === '-') return -argument;
        if (node.operator === '+') return +argument;
        throw new Error('Operador fora do DSL');
      }
      case 'BinaryExpression':
        if (node.operator === '===') return read(node.left) === read(node.right);
        if (node.operator === '!==') return read(node.left) !== read(node.right);
        throw new Error('Operador binário fora do DSL');
      case 'ConditionalExpression': return read(node.test) ? read(node.consequent) : read(node.alternate);
      case 'TemplateLiteral':
        return node.quasis.reduce((result, quasi, index) => result + quasi.value.cooked
          + (index < node.expressions.length ? String(read(node.expressions[index])) : ''), '');
      case 'MemberExpression': {
        const object = read(node.object);
        const key = node.computed ? read(node.property) : node.property.name;
        if (!object || ['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(object, key)) {
          throw new Error('Acesso fora de uma constante própria');
        }
        return object[key];
      }
      case 'CallExpression': {
        if (node.callee.type !== 'Identifier') throw new Error('Chamadas externas excluídas do DSL');
        const closure = read(node.callee);
        if (!closure?.[closureBrand]) throw new Error('Apenas factories literais do schema');
        const argumentsList = node.arguments.map((argument) => read(argument));
        const scope = new Map(closure.environment);
        closure.node.params.forEach((parameter, index) => {
          const target = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
          if (target.type !== 'Identifier') throw new Error('Parâmetro fora do DSL');
          const value = argumentsList[index] === undefined && parameter.type === 'AssignmentPattern'
            ? evaluate(parameter.right, scope, depth + 1) : argumentsList[index];
          scope.set(target.name, value);
        });
        return evaluate(closure.node.body, scope, depth + 1);
      }
      default: throw new Error('Nó fora do DSL: ' + node.type);
    }
  }
  return evaluate;
}

function recoverSchema(ast) {
  const expression = ast.body[0]?.expression;
  const call = expression?.type === 'UnaryExpression' ? expression.argument : expression;
  if (call?.type !== 'CallExpression' || call.callee.type !== 'FunctionExpression') {
    throw new Error('Envelope IIFE diferente do schema observado');
  }
  const declarations = call.callee.body.body.filter((statement) => statement.type === 'VariableDeclaration')
    .flatMap((statement) => statement.declarations);
  const exportedSchema = declarations.find((declaration) => declaration.init?.type === 'ObjectExpression'
    && declaration.init.properties.some((property) => property.key?.name === 'tabs'));
  const tabsProperty = exportedSchema?.init.properties.find((property) => property.key?.name === 'tabs');
  if (tabsProperty?.value.type !== 'Identifier') throw new Error('Referência às tabs ausente');
  const environment = new Map();
  const evaluate = literalEvaluator();
  for (const declaration of declarations) {
    if (declaration.id.type !== 'Identifier') throw new Error('Declaração fora do DSL');
    environment.set(declaration.id.name, evaluate(declaration.init, environment));
    if (declaration.id.name === tabsProperty.value.name) {
      return JSON.parse(JSON.stringify(environment.get(declaration.id.name)));
    }
  }
  throw new Error('Tabela de campos ausente');
}

function defaults(fields) {
  const result = Object.create(null);
  for (const field of fields) {
    if (['__proto__', 'prototype', 'constructor'].includes(field.key)) throw new Error('Chave reservada');
    result[field.key] = field.type === 'object' ? defaults(field.fields)
      : field.type === 'list' ? [] : field.default;
  }
  return result;
}

if (require.main === module) {
  const acorn = require(process.env.PKA_ACORN_ROOT);
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'readable/shared/schema.js'), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest' });
  const tabs = recoverSchema(normalizedAst(ast));
  const config = Object.fromEntries(tabs.map((tab) => [tab.key, defaults(tab.fields)]));
  fs.writeFileSync(path.join(root, 'schema_fields.json'), JSON.stringify(tabs, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'default_config.json'), JSON.stringify(config, null, 2) + '\n');
  console.log(JSON.stringify({ tabs: tabs.length, groups: tabs.map((tab) => tab.key) }));
}

module.exports = { literalEvaluator, recoverSchema, defaults };
