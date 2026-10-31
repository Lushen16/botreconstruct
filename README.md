# PKA Bot Reconstruct (Open-Source Core)

Reconstrução autônoma do motor de automação e interface compatível com PKA / Shiba Bot.

## 🚀 Arquitetura do Projeto

- **UI / Frontend**: Aplicação Electron modular (
econstruction/app) com 8 abas de controle (Target, Walker, Healer, Looter, Settings, etc.).
- **Motores Core (
econstruction/engines/)**:
  - walker-engine.cjs: Navegação universal no plano 2D com suporte a transições dinâmicas de andar (escadas/buracos).
  - 	arget-engine.cjs: Seleção inteligente de alvos com suporte nativo a priorização de Pokémon Shiny e proteção do próprio time.
  - capture-engine.cjs: Arremesso automático de Pokébolas configuradas via IDs de corpos no chão.
  - shared.cjs: Cálculo de distâncias Chebyshev e geometria 2D/3D.
- **Runtimes de Atuação**:
  - RpmCombatRuntime: Conexão direta de leitura de memória e envio de comandos assíncronos (PostMessageW) para execução silenciosa em segundo plano sem roubar o foco do computador.

## 📦 Como Executar

### Pré-requisitos
- Node.js v18+ ou v20+
- Electron instalado globalmente (
pm install -g electron) ou runtime local.

### Inicialização
Para iniciar a interface do bot:
`ash
# Via npm/npx
cd reconstruction/app
npx electron .

# Ou via scripts na raiz
ABRIR_RECONSTRUCAO.bat
`

## 🧪 Testes Automatizados
O projeto conta com mais de 530 testes automatizados que cobrem contratos de IPC, regras matemáticas de movimentação 2D, motores de mira e captura:
`ash
node --test tests/engines.test.cjs tests/walker_input_runtime.test.cjs
`
