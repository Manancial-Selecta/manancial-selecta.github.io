# Louvores Manancial

App do ministério **Adoração & Artes Manancial Selecta**: cultos, louvores, cifras para **violão e teclado** (com os desenhos dos acordes), vídeo do YouTube em cima da cifra e a mensagem pronta para o grupo do WhatsApp.

- Instala no **Android** e no **iPhone** (ícone na tela inicial, tela cheia).
- **Tempo real:** o que uma pessoa altera aparece na hora para todas.
- **Sem internet:** abre e mostra as cifras guardadas; o que for alterado é enviado quando a internet voltar.
- **Todos os membros podem editar.** Para entrar: o link do app + o código do ministério + o nome.
- **Endereço:** https://manancial-selecta.github.io/ (organização `manancial-selecta` no GitHub).
- **Custo zero:** Firebase (plano gratuito Spark) para os dados e GitHub Pages para o endereço do app.

---

## Como colocar no ar (uma vez só)

### 1. Firebase — onde ficam os dados

1. Entre em **console.firebase.google.com** com a conta Google do ministério → **Criar um projeto** → nome `louvores-manancial` → pode desligar o Google Analytics → **Criar**.
2. Menu **Segurança → Authentication → Vamos começar** → aba **Método de login** → **Anônimo** → **Ativar** → **Salvar**. (Se não achar, use **Pesquise produtos** e digite "Authentication".)
3. Menu **Bancos de dados e armazenamento → Firestore → Criar banco de dados** → local **southamerica-east1 (São Paulo)** → **modo de produção** → **Criar**.
4. Ainda no Firestore, aba **Regras**: apague o que estiver lá, cole todo o conteúdo do arquivo `firestore.rules` e clique em **Publicar**.
5. Engrenagem → **Configurações do projeto** → **Seus apps** → botão **`</>`** (Web) → apelido `louvores` → **Registrar app**. Aparece um bloco `firebaseConfig` com `apiKey`, `authDomain`, `projectId`... Copie esses valores para o arquivo `src/config.js` (ou mande para o Claude). Ignore a parte do `npm install` e toque em **Continuar no console**. Eles não são senha: quem protege os dados são as regras do passo 4.

### 2. GitHub — o endereço do app

1. Crie uma conta em **github.com** (pode ser com o e-mail do ministério).
2. **+ → New repository** → nome `louvores` → **Public** → **Create repository**.
3. Coloque os arquivos desta pasta no repositório. Duas formas:
   - conecte o GitHub ao Claude (Configurações → Conectores → GitHub, liberando o repositório `louvores`) e peça para ele enviar; ou
   - num computador, clique em **uploading an existing file** e arraste todos os arquivos e pastas.
4. No repositório: **Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: **main**, pasta **/ (root)** → **Save**.
   Em um ou dois minutos o app fica em `https://SEU-USUARIO.github.io/louvores/`.

> O repositório é público, por isso **nenhum dado do ministério fica no código**. Os louvores e cultos do protótipo entram pelo arquivo `prototipo.json` no passo 3.

### 3. Configurar o app

1. No celular, abra `https://SEU-USUARIO.github.io/louvores/#setup`.
2. Escolha o **código do ministério** (pelo menos 6 letras ou números), escreva seu nome, deixe marcado **Trazer os louvores e cultos do protótipo** e escolha o arquivo `prototipo.json` que o Claude mandou → **Configurar**.
3. Pronto: você é a pessoa administradora. Mande no grupo o link (sem o `#setup`) e o código.

### 4. Cada pessoa do ministério

1. Abre o link, digita o código e o nome → **Entrar** (só na primeira vez).
2. Instala: no **iPhone**, pelo Safari → **Compartilhar → Adicionar à Tela de Início**; no **Android**, pelo Chrome → menu **⋮ → Instalar app**. O app também mostra essas instruções.

---

## Administração

> Depois de atualizar o app para a versão 1.1, cole de novo o arquivo `firestore.rules` em Firebase → Firestore → **Regras** → **Publicar** (a senha de administrador e o histórico precisam das regras novas).

- **Mudar o código:** botão com suas iniciais → **Código do ministério**. Quem já entrou continua com acesso.
- **Tirar o acesso de alguém:** Firebase → Firestore → coleção `members` → apague o documento da pessoa (o nome está dentro) e, se quiser, mude o código.
- **Senha de administrador:** iniciais → **Senha de administrador** → escolha a senha (pelo menos 4 letras ou números). Quem souber a senha toca em iniciais → **Entrar como administrador** e vira administrador, sem mexer no Firebase.
- **Outra pessoa administradora pelo Firebase (alternativa):** Firestore → `members` → documento da pessoa → mude `admin` para `true`.
- **Histórico (7 dias):** iniciais → **Histórico**. Mostra quem abriu o app em cada dia e o que foi alterado (cultos, louvores, tons, ordem, ensaio, código e senha). Só quem administra vê. O que passa de 8 dias é apagado sozinho.
- **Enviar o app para alguém:** iniciais → **Enviar o app no WhatsApp** (todos podem). A mensagem leva só o link; o código a pessoa pede para a liderança.
- **Importar o protótipo de novo:** iniciais → **Importar dados do protótipo** (só para quem administra).

## Limites do plano gratuito

O Firestore gratuito permite 50 mil leituras e 20 mil gravações por dia. O app guarda tudo no aparelho e, ao abrir, só baixa o que mudou desde a última vez, então o ministério inteiro usa uma pequena parte disso.

---

## Para quem for mexer no código

Não tem etapa de build: são arquivos estáticos (HTML, CSS e módulos JavaScript) servidos como estão.

| Arquivo | O que faz |
|---|---|
| `index.html`, `style.css`, `manifest.webmanifest`, `icons/` | página, visual (preto e amarelo, claro e escuro) e ícones do app instalado |
| `sw.js` | modo offline. **Mude `VERSION` a cada publicação**: quem estiver usando vê "Tem uma versão nova do app" |
| `src/main.js` | começo: modo offline, aviso de versão nova, abre o app |
| `src/config.js` | dados do Firebase (vazio = modo demonstração, tudo só no aparelho) |
| `src/app.js` | telas: Cultos, Louvores, página do culto, louvor, editores, entrada |
| `src/store-firebase.js` | dados em tempo real (Firebase 12.19.0 carregado do gstatic), entrada com código, fila sem internet |
| `src/store-local.js` | modo demonstração (sem Firebase) |
| `src/model.js` | formato dos louvores, cultos e preferências |
| `src/domain.js` | regras do ministério: Ceia no 1º domingo, ensaios (domingo 15h45, sexta 19h00), mensagem do WhatsApp |
| `src/parse.js` | lê a mensagem da escala colada do grupo |
| `src/music.js` | tons, transposição, capotraste, cifras |
| `src/chords.js` | desenhos dos acordes: violão (formas conhecidas + busca) e teclado |
| `src/youtube.js` | vídeo do YouTube dentro do app |
| `firestore.rules` | regras de acesso do banco |

**Banco (Firestore):** `songs/{id}` (louvor: título, versão, tom, `cifra` e `cifraKb` de teclado, `yt`...), `lists/{id}` (culto: data, ministro, tipo, ensaio, louvores, dízimos, aviso), `meta/app` (nomes e horários de ensaio lembrados), `members/{uid}` (quem entrou), `config/access` (código, só as regras leem), `config/admin` (senha de administrador, só as regras leem), `log/{id}` (histórico: quem abriu e o que mudou; só administrador lê) e `config/public`. Excluir marca `deleted: true` (permite desfazer). Cada gravação leva `at` (hora do servidor) e `by` (nome de quem alterou).

**Testes** (precisam de Node e do Playwright):

```
node tests/unit.mjs       # escala, mensagem do WhatsApp, acordes, dados
node tests/ui.cjs         # telas no modo demonstração
node tests/firebase.cjs   # tempo real, entrada com código, sem internet (Firebase imitado)
node tests/offline.cjs    # abrir sem internet e atualizar versão
```
